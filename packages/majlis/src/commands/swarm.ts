import * as path from 'node:path';
import { execSync, execFileSync } from 'node:child_process';
import { getDb, findProjectRoot } from '../db/connection.js';
import {
  createSwarmRun,
  updateSwarmRun,
  addSwarmMember,
  updateSwarmMember,
  listAllDeadEnds,
  getExperimentBySlug,
} from '../db/queries.js';
import { adminTransitionAndPersist } from '../state/machine.js';
import { ExperimentStatus } from '../state/types.js';
import { spawnSynthesiser, generateSlug } from '../agents/spawn.js';
import { loadConfig, readFileOrEmpty, readLatestDiagnosis, truncateContext, CONTEXT_LIMITS, getFlagValue } from '../config.js';
import { createWorktree, initializeWorktree, cleanupWorktree } from '../swarm/worktree.js';
import { runExperimentInWorktree } from '../swarm/runner.js';
import { aggregateSwarmResults } from '../swarm/aggregate.js';
import { isShutdownRequested } from '../shutdown.js';
import type { WorktreeInfo, SwarmExperimentResult } from '../swarm/types.js';
import type { Grade } from '../state/types.js';
import * as fmt from '../output/format.js';

const MAX_PARALLEL = 8;
const DEFAULT_PARALLEL = 3;

/**
 * `majlis swarm "goal" [--parallel N]`
 *
 * Run N experiments in parallel git worktrees, aggregate results,
 * merge the best experiment, and compress findings.
 */
export async function swarm(args: string[]): Promise<void> {
  const root = findProjectRoot();
  if (!root) throw new Error('Not in a Majlis project. Run `majlis init` first.');

  const goal = args.filter(a => !a.startsWith('--')).join(' ');
  if (!goal) throw new Error('Usage: majlis swarm "goal description" [--parallel N]');

  const parallelStr = getFlagValue(args, '--parallel');
  const parallelCount = Math.min(
    Math.max(2, parseInt(parallelStr ?? String(DEFAULT_PARALLEL), 10) || DEFAULT_PARALLEL),
    MAX_PARALLEL,
  );

  // Validate clean git state
  try {
    const status = execSync('git status --porcelain', {
      cwd: root, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    if (status) {
      fmt.warn('Working tree has uncommitted changes. Commit or stash before swarming.');
      throw new Error('Dirty working tree. Commit or stash first.');
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes('Dirty working tree')) throw err;
    fmt.warn('Could not check git status.');
  }

  const db = getDb(root);
  const swarmRun = createSwarmRun(db, goal, parallelCount);

  fmt.header(`Swarm Mode — ${goal}`);
  fmt.info(`Generating ${parallelCount} diverse hypotheses...`);

  // Phase 1: Generate diverse hypotheses
  const hypotheses = await deriveMultipleHypotheses(goal, root, parallelCount);
  if (hypotheses.length === 0) {
    fmt.success('Planner says the goal has been met. Nothing to swarm.');
    updateSwarmRun(db, swarmRun.id, 'completed', 0, null);
    return;
  }

  fmt.info(`Got ${hypotheses.length} hypotheses:`);
  for (let i = 0; i < hypotheses.length; i++) {
    fmt.info(`  ${i + 1}. ${hypotheses[i]}`);
  }

  // Cleanup orphaned worktrees from prior crashed runs
  try {
    const worktreeList = execFileSync('git', ['worktree', 'list', '--porcelain'], {
      cwd: root, encoding: 'utf-8',
    });
    const orphaned = worktreeList.split('\n')
      .filter(line => line.startsWith('worktree '))
      .map(line => line.replace('worktree ', ''))
      .filter(p => p.includes('-swarm-'));
    for (const orphanPath of orphaned) {
      try {
        execFileSync('git', ['worktree', 'remove', orphanPath, '--force'], { cwd: root, encoding: 'utf-8' });
        fmt.info(`Cleaned up orphaned worktree: ${path.basename(orphanPath)}`);
      } catch { /* best effort */ }
    }
    if (orphaned.length > 0) {
      execFileSync('git', ['worktree', 'prune'], { cwd: root, encoding: 'utf-8' });
    }
  } catch { /* ignore cleanup errors */ }

  // Phase 2: Create worktrees
  const worktrees: WorktreeInfo[] = [];
  for (let i = 0; i < hypotheses.length; i++) {
    const paddedNum = String(i + 1).padStart(3, '0');
    const slug = await generateSlug(hypotheses[i], root);

    try {
      const wt = createWorktree(root, slug, paddedNum);
      wt.hypothesis = hypotheses[i];
      initializeWorktree(root, wt.path);
      worktrees.push(wt);
      addSwarmMember(db, swarmRun.id, slug, wt.path);
      fmt.info(`Created worktree ${paddedNum}: ${slug}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      fmt.warn(`Failed to create worktree for hypothesis ${i + 1}: ${msg}`);
    }
  }

  if (worktrees.length === 0) {
    fmt.warn('No worktrees created. Aborting swarm.');
    updateSwarmRun(db, swarmRun.id, 'failed', 0, null);
    return;
  }

  fmt.info(`Running ${worktrees.length} experiments in parallel...`);
  fmt.info('');

  let results: SwarmExperimentResult[];
  let summary: ReturnType<typeof aggregateSwarmResults>;

  try {
    // Phase 3: Run experiments in parallel
    const settled = await Promise.allSettled(
      worktrees.map(wt => runExperimentInWorktree(wt)),
    );

    // Collect results
    results = settled.map((s, i) => {
      if (s.status === 'fulfilled') return s.value;
      return {
        worktree: worktrees[i],
        experiment: null,
        finalStatus: 'error',
        overallGrade: null,
        costUsd: 0,
        stepCount: 0,
        error: s.reason instanceof Error ? s.reason.message : String(s.reason),
      };
    });

    // Update swarm members in main DB
    for (const r of results) {
      updateSwarmMember(
        db, swarmRun.id, r.worktree.slug,
        r.finalStatus, r.overallGrade, r.costUsd, r.error ?? null,
      );
    }

    fmt.info('');
    fmt.header('Aggregation');

    // Phase 4: Aggregate results into main DB
    summary = aggregateSwarmResults(root, db, results);
    summary.goal = goal;

    // Phase 5: Git merge best experiment
    if (summary.bestExperiment && isMergeable(summary.bestExperiment.overallGrade)) {
      const best = summary.bestExperiment;
      fmt.info(`Best experiment: ${best.worktree.slug} (${best.overallGrade})`);

      try {
        execFileSync('git', ['merge', best.worktree.branch, '--no-ff', '-m', `Merge swarm winner: ${best.worktree.slug}`],
          { cwd: root, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
        );
        fmt.success(`Merged ${best.worktree.slug} into main.`);
      } catch {
        fmt.warn(`Git merge of ${best.worktree.slug} failed. Merge manually with:`);
        fmt.info(`  git merge ${best.worktree.branch} --no-ff`);
      }
    } else {
      fmt.info('No experiment achieved sound/good grade. Nothing merged.');
    }

    // Mark non-best experiments as dead-ends in main DB (for learnings)
    for (const r of results) {
      if (r === summary.bestExperiment || r.error || !r.experiment) continue;
      const mainExp = getExperimentBySlug(db, r.worktree.slug);
      if (mainExp && mainExp.status !== 'dead_end') {
        adminTransitionAndPersist(db, mainExp.id, mainExp.status as ExperimentStatus, ExperimentStatus.DEAD_END, 'error_recovery');
      }
    }

    // Phase 6: Update swarm run record
    updateSwarmRun(
      db, swarmRun.id,
      summary.errorCount === results.length ? 'failed' : 'completed',
      summary.totalCostUsd,
      summary.bestExperiment?.worktree.slug ?? null,
    );
  } finally {
    // Phase 7: Cleanup worktrees — always runs, even on crash
    fmt.info('Cleaning up worktrees...');
    for (const wt of worktrees) {
      cleanupWorktree(root, wt);
    }
  }

  // Phase 8: Print summary
  fmt.info('');
  fmt.header('Swarm Summary');
  fmt.info(`Goal: ${goal}`);
  fmt.info(`Parallel: ${worktrees.length}`);
  fmt.info(`Results:`);
  for (const r of results) {
    const grade = r.overallGrade ?? 'n/a';
    const status = r.error ? `ERROR: ${r.error.slice(0, 60)}` : r.finalStatus;
    const marker = r === summary.bestExperiment ? ' <-- BEST' : '';
    fmt.info(`  ${r.worktree.paddedNum} ${r.worktree.slug}: ${grade} (${status})${marker}`);
  }
  fmt.info(`Merged: ${summary.mergedCount} | Dead-ends: ${summary.deadEndCount} | Errors: ${summary.errorCount}`);
}

function isMergeable(grade: Grade | null): boolean {
  return grade === 'sound' || grade === 'good';
}

/**
 * Generate N diverse hypotheses for parallel experimentation.
 * Modified version of deriveNextHypothesis from run.ts.
 */
async function deriveMultipleHypotheses(
  goal: string,
  root: string,
  count: number,
): Promise<string[]> {
  const synthesis = truncateContext(
    readFileOrEmpty(path.join(root, 'docs', 'synthesis', 'current.md')),
    CONTEXT_LIMITS.synthesis,
  );
  const fragility = truncateContext(
    readFileOrEmpty(path.join(root, 'docs', 'synthesis', 'fragility.md')),
    CONTEXT_LIMITS.fragility,
  );
  const deadEndsDoc = truncateContext(
    readFileOrEmpty(path.join(root, 'docs', 'synthesis', 'dead-ends.md')),
    CONTEXT_LIMITS.deadEnds,
  );
  const diagnosis = truncateContext(readLatestDiagnosis(root), CONTEXT_LIMITS.synthesis);
  const db = getDb(root);
  const deadEnds = listAllDeadEnds(db);
  const config = loadConfig(root);

  // Run metrics if configured
  let metricsOutput = '';
  if (config.metrics?.command) {
    try {
      metricsOutput = execSync(config.metrics.command, {
        cwd: root, encoding: 'utf-8', timeout: 60_000,
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();
    } catch {
      metricsOutput = '(metrics command failed)';
    }
  }

  const result = await spawnSynthesiser({
    taskPrompt: `You are the Planner for a parallel Majlis swarm.

## Goal
${goal}
${diagnosis ? `\n## Latest Diagnosis Report (PRIORITISE — deep analysis from diagnostician agent)\n${diagnosis}\n` : ''}
## Current Metrics
${metricsOutput || '(no metrics configured)'}

## Synthesis (what we know so far)
${synthesis || '(empty — first experiment)'}

## Fragility Map (known weak areas)
${fragility || '(none)'}

## Dead-End Registry
${deadEndsDoc || '(none)'}

## Dead Ends (from DB — ${deadEnds.length} total)
${deadEnds.map(d => `- [${d.category ?? 'structural'}] ${d.approach}: ${d.why_failed} [constraint: ${d.structural_constraint}]`).join('\n') || '(none)'}

Note: [structural] dead ends are HARD CONSTRAINTS — hypotheses MUST NOT repeat these approaches.
[procedural] dead ends are process failures — the approach may still be valid if executed differently.

## Your Task
DO NOT read source code or use tools. All context you need is above. Plan from the synthesis and dead-end registry.

1. Assess: based on the metrics and synthesis, has the goal been met? Be specific.
2. If YES — output the JSON block below with goal_met: true.
3. If NO — generate exactly ${count} DIVERSE hypotheses for parallel testing.

Requirements for hypotheses:
- Each must attack the problem from a DIFFERENT angle
- They must NOT share the same mechanism, function target, or strategy
- At least one should be an unconventional or indirect approach
- None may repeat a dead-ended structural approach
- Each must be specific and actionable — name the function or mechanism to change
- Do NOT reference specific line numbers — they shift between experiments

CRITICAL: Your LAST line of output MUST be EXACTLY this format (on its own line, nothing after it):
<!-- majlis-json {"goal_met": false, "hypotheses": ["hypothesis 1", "hypothesis 2", "hypothesis 3"]} -->

If the goal is met:
<!-- majlis-json {"goal_met": true, "hypotheses": []} -->`,
  }, root, { maxTurns: 2, tools: [] });

  // Parse response
  if (result.structured?.goal_met === true) return [];

  if (result.structured?.hypotheses && Array.isArray(result.structured.hypotheses)) {
    return result.structured.hypotheses.filter(
      (h: unknown): h is string => typeof h === 'string' && h.length > 10,
    );
  }

  // Fallback: try manual extraction
  const blockMatch = result.output.match(/<!--\s*majlis-json\s*(\{[\s\S]*?\})\s*-->/);
  if (blockMatch) {
    try {
      const parsed = JSON.parse(blockMatch[1]);
      if (parsed.goal_met === true) return [];
      if (Array.isArray(parsed.hypotheses)) {
        return parsed.hypotheses.filter(
          (h: unknown): h is string => typeof h === 'string' && h.length > 10,
        );
      }
    } catch { /* ignore parse errors */ }
  }

  fmt.warn('Planner did not return structured hypotheses. Using goal as single hypothesis.');
  return [goal];
}
