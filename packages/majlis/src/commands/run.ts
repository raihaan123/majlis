import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import { getDb, findProjectRoot } from '../db/connection.js';
import {
  getLatestExperiment,
  listActiveExperiments,
  listAllDeadEnds,
  getSessionsSinceCompression,
  createExperiment,
  getExperimentBySlug,
} from '../db/queries.js';
import { isTerminal } from '../state/machine.js';
import { ExperimentStatus } from '../state/types.js';
import { next } from './next.js';
import { cycle } from './cycle.js';
import { spawnSynthesiser } from '../agents/spawn.js';
import type { MajlisConfig, Experiment } from '../types.js';
import * as fmt from '../output/format.js';

/**
 * Autonomous orchestration — `majlis run "goal"`.
 * Reads synthesis, dead-ends, fragility. Spawns experiments automatically.
 * Loops until goal is met, circuit breaker triggers, or max experiments reached.
 */
export async function run(args: string[]): Promise<void> {
  const root = findProjectRoot();
  if (!root) throw new Error('Not in a Majlis project. Run `majlis init` first.');

  const goal = args.filter(a => !a.startsWith('--')).join(' ');
  if (!goal) {
    throw new Error('Usage: majlis run "goal description"');
  }

  const db = getDb(root);
  const config = loadConfig(root);
  const MAX_EXPERIMENTS = 10;
  const MAX_STEPS = 200; // safety valve for total steps across all experiments

  let experimentCount = 0;
  let stepCount = 0;

  fmt.header(`Autonomous Mode — ${goal}`);

  while (stepCount < MAX_STEPS && experimentCount < MAX_EXPERIMENTS) {
    stepCount++;

    // Get the active experiment
    let exp = getLatestExperiment(db);

    // No active experiment — need to create one
    if (!exp) {
      experimentCount++;

      if (experimentCount > MAX_EXPERIMENTS) {
        fmt.warn(`Reached max experiments (${MAX_EXPERIMENTS}). Stopping.`);
        break;
      }

      // Auto-compress if due (before planning next experiment)
      const sessionsSinceCompression = getSessionsSinceCompression(db);
      if (sessionsSinceCompression >= config.cycle.compression_interval) {
        fmt.info('Compressing before next experiment...');
        await cycle('compress', []);
      }

      // Derive the next hypothesis from goal + context
      fmt.info(`[Experiment ${experimentCount}/${MAX_EXPERIMENTS}] Planning next experiment...`);
      const hypothesis = await deriveNextHypothesis(goal, root, db);

      if (!hypothesis) {
        fmt.success('Planner says the goal has been met. Stopping.');
        break;
      }

      fmt.info(`Next hypothesis: ${hypothesis}`);

      // Create the experiment programmatically
      exp = createNewExperiment(db, root, hypothesis);
      fmt.success(`Created experiment #${exp.id}: ${exp.slug}`);
    }

    // If experiment is terminal, loop back to create a new one
    if (isTerminal(exp.status as ExperimentStatus)) {
      if (exp.status === 'merged') {
        fmt.success(`Experiment ${exp.slug} merged.`);
      } else if (exp.status === 'dead_end') {
        fmt.info(`Experiment ${exp.slug} dead-ended.`);
      }
      continue;
    }

    // Execute next step
    fmt.info(`[Step ${stepCount}] ${exp.slug}: ${exp.status}`);
    await next([exp.slug], false);
  }

  if (stepCount >= MAX_STEPS) {
    fmt.warn(`Reached max steps (${MAX_STEPS}). Stopping autonomous mode.`);
  }

  fmt.header('Autonomous Mode Complete');
  fmt.info(`Goal: ${goal}`);
  fmt.info(`Experiments: ${experimentCount}, Steps: ${stepCount}`);
  fmt.info('Run `majlis status` to see final state.');
}

/**
 * Derive the next experiment hypothesis using a planner agent.
 * Returns null if the planner determines the goal has been met.
 */
async function deriveNextHypothesis(
  goal: string,
  root: string,
  db: ReturnType<typeof getDb>,
): Promise<string | null> {
  // Gather context
  const synthesis = readFileOrEmpty(path.join(root, 'docs', 'synthesis', 'current.md'));
  const fragility = readFileOrEmpty(path.join(root, 'docs', 'synthesis', 'fragility.md'));
  const deadEndsDoc = readFileOrEmpty(path.join(root, 'docs', 'synthesis', 'dead-ends.md'));
  const deadEnds = listAllDeadEnds(db);
  const config = loadConfig(root);

  // Run metrics if configured
  let metricsOutput = '';
  if (config.metrics?.command) {
    try {
      metricsOutput = execSync(config.metrics.command, {
        cwd: root,
        encoding: 'utf-8',
        timeout: 60_000,
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();
    } catch {
      metricsOutput = '(metrics command failed)';
    }
  }

  const result = await spawnSynthesiser({
    taskPrompt: `You are the Planner for an autonomous Majlis run.

## Goal
${goal}

## Current Metrics
${metricsOutput || '(no metrics configured)'}

## Synthesis (what we know so far)
${synthesis || '(empty — first experiment)'}

## Fragility Map (known weak areas)
${fragility || '(none)'}

## Dead-End Registry
${deadEndsDoc || '(none)'}

## Dead Ends (from DB — ${deadEnds.length} total)
${deadEnds.map(d => `- ${d.approach}: ${d.why_failed} [constraint: ${d.structural_constraint}]`).join('\n') || '(none)'}

## Your Task
1. Assess: based on the metrics and synthesis, has the goal been met? Be specific.
2. If YES — output: <!-- majlis-json {"goal_met": true, "hypothesis": null} -->
3. If NO — propose the SINGLE most promising next experiment hypothesis.
   - It must NOT repeat a dead-ended approach
   - It should attack the weakest point revealed by synthesis/fragility
   - It should be specific and actionable (not vague)
   - Output: <!-- majlis-json {"goal_met": false, "hypothesis": "your hypothesis here"} -->

IMPORTANT: You MUST output the <!-- majlis-json --> block. This is how the framework reads your decision.`,
  }, root);

  // Parse the planner's response
  const structured = result.structured;
  if (structured?.goal_met === true) {
    return null;
  }

  if (structured?.hypothesis) {
    return structured.hypothesis;
  }

  // Fallback: try to extract hypothesis from the markdown
  const match = result.output.match(/hypothesis["\s:]+([^"}\n]+)/i);
  if (match) return match[1].trim();

  // Last resort: use the goal itself as the hypothesis
  fmt.warn('Planner did not return a structured hypothesis. Using goal as fallback.');
  return goal;
}

/**
 * Create a new experiment programmatically (mirrors newExperiment command).
 */
function createNewExperiment(
  db: ReturnType<typeof getDb>,
  root: string,
  hypothesis: string,
): Experiment {
  const slug = slugify(hypothesis);

  // Dedup slug
  let finalSlug = slug;
  let attempt = 0;
  while (getExperimentBySlug(db, finalSlug)) {
    attempt++;
    finalSlug = `${slug}-${attempt}`;
  }

  // Experiment number
  const allExps = db.prepare('SELECT COUNT(*) as count FROM experiments').get() as { count: number };
  const num = allExps.count + 1;
  const paddedNum = String(num).padStart(3, '0');

  // Create git branch
  const branch = `exp/${paddedNum}-${finalSlug}`;
  try {
    execSync(`git checkout -b ${branch}`, {
      cwd: root,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    fmt.info(`Created branch: ${branch}`);
  } catch {
    fmt.warn(`Could not create branch ${branch} — continuing without git branch.`);
  }

  // Create DB entry
  const exp = createExperiment(db, finalSlug, branch, hypothesis, null, null);

  // Create experiment log from template
  const docsDir = path.join(root, 'docs', 'experiments');
  const templatePath = path.join(docsDir, '_TEMPLATE.md');
  if (fs.existsSync(templatePath)) {
    const template = fs.readFileSync(templatePath, 'utf-8');
    const logContent = template
      .replace(/\{\{title\}\}/g, hypothesis)
      .replace(/\{\{hypothesis\}\}/g, hypothesis)
      .replace(/\{\{branch\}\}/g, branch)
      .replace(/\{\{status\}\}/g, 'classified')
      .replace(/\{\{sub_type\}\}/g, 'unclassified')
      .replace(/\{\{date\}\}/g, new Date().toISOString().split('T')[0]);
    const logPath = path.join(docsDir, `${paddedNum}-${finalSlug}.md`);
    fs.writeFileSync(logPath, logContent);
    fmt.info(`Created experiment log: docs/experiments/${paddedNum}-${finalSlug}.md`);
  }

  return exp;
}

function readFileOrEmpty(filePath: string): string {
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return '';
  }
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50);
}

function loadConfig(projectRoot: string): MajlisConfig {
  const configPath = path.join(projectRoot, '.majlis', 'config.json');
  if (!fs.existsSync(configPath)) {
    return {
      project: { name: '', description: '', objective: '' },
      cycle: {
        compression_interval: 5,
        circuit_breaker_threshold: 3,
        require_doubt_before_verify: true,
        require_challenge_before_verify: false,
        auto_baseline_on_new_experiment: true,
      },
    } as MajlisConfig;
  }
  return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
}
