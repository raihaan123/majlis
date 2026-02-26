import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync, execFileSync } from 'node:child_process';
import { getDb, findProjectRoot } from '../db/connection.js';
import {
  createExperiment,
  getExperimentBySlug,
  getLatestExperiment,
  insertDeadEnd,
} from '../db/queries.js';
import { adminTransitionAndPersist } from '../state/machine.js';
import { ExperimentStatus } from '../state/types.js';
import { loadConfig, getFlagValue } from '../config.js';
import { generateSlug } from '../agents/spawn.js';
import { autoCommit } from '../git.js';
import * as fmt from '../output/format.js';

export async function newExperiment(args: string[]): Promise<void> {
  const root = findProjectRoot();
  if (!root) throw new Error('Not in a Majlis project. Run `majlis init` first.');

  const hypothesis = args.filter(a => !a.startsWith('--')).join(' ');
  if (!hypothesis) {
    throw new Error('Usage: majlis new "hypothesis"');
  }

  const db = getDb(root);
  const config = loadConfig(root);

  // Use explicit --slug if provided, otherwise generate via Haiku
  const slug = getFlagValue(args, '--slug') ?? await generateSlug(hypothesis, root);

  // Check for duplicates
  if (getExperimentBySlug(db, slug)) {
    throw new Error(`Experiment with slug "${slug}" already exists.`);
  }

  // Determine experiment number
  const allExps = db.prepare('SELECT COUNT(*) as count FROM experiments').get() as { count: number };
  const num = allExps.count + 1;
  const paddedNum = String(num).padStart(3, '0');

  // Create git branch
  const branch = `exp/${paddedNum}-${slug}`;
  try {
    execFileSync('git', ['checkout', '-b', branch], {
      cwd: root,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    fmt.info(`Created branch: ${branch}`);
  } catch (err) {
    fmt.warn(`Could not create branch ${branch} — continuing without git branch.`);
  }

  // Parse optional flags (bounds-checked)
  const subType = getFlagValue(args, '--sub-type') ?? null;

  // Create DB entry
  const exp = createExperiment(db, slug, branch, hypothesis, subType, null);
  fmt.success(`Created experiment #${exp.id}: ${exp.slug}`);

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
      .replace(/\{\{sub_type\}\}/g, subType ?? 'unclassified')
      .replace(/\{\{date\}\}/g, new Date().toISOString().split('T')[0]);
    const logPath = path.join(docsDir, `${paddedNum}-${slug}.md`);
    fs.writeFileSync(logPath, logContent);
    fmt.info(`Created experiment log: docs/experiments/${paddedNum}-${slug}.md`);
  }

  autoCommit(root, `new: ${slug}`);

  // Auto-baseline if configured
  if (config.cycle.auto_baseline_on_new_experiment && config.metrics.command) {
    fmt.info('Auto-baselining... (run `majlis baseline` to do this manually)');
    try {
      const { baseline } = await import('./measure.js');
      await baseline(['--experiment', String(exp.id)]);
    } catch (err) {
      fmt.warn('Auto-baseline failed — run `majlis baseline` manually.');
    }
  }
}

export async function revert(args: string[]): Promise<void> {
  const root = findProjectRoot();
  if (!root) throw new Error('Not in a Majlis project. Run `majlis init` first.');

  const db = getDb(root);

  // Get experiment — by slug or latest
  let exp;
  const slugArg = args.filter(a => !a.startsWith('--'))[0];
  if (slugArg) {
    exp = getExperimentBySlug(db, slugArg);
    if (!exp) throw new Error(`Experiment not found: ${slugArg}`);
  } else {
    exp = getLatestExperiment(db);
    if (!exp) throw new Error('No active experiments to revert.');
  }

  // Record dead-end
  const reason = getFlagValue(args, '--reason') ?? 'Manually reverted';
  const category = args.includes('--structural') ? 'structural' as const : 'procedural' as const;

  insertDeadEnd(
    db,
    exp.id,
    exp.hypothesis ?? exp.slug,
    reason,
    `Reverted: ${reason}`,
    exp.sub_type,
    category,
  );

  // Update status via validated admin transition
  adminTransitionAndPersist(db, exp.id, exp.status as ExperimentStatus, ExperimentStatus.DEAD_END, 'revert');

  // Handle git branch
  try {
    const currentBranch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: root,
      encoding: 'utf-8',
    }).trim();

    if (currentBranch === exp.branch) {
      try {
        execFileSync('git', ['checkout', 'main'], {
          cwd: root,
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe'],
        });
      } catch {
        execFileSync('git', ['checkout', 'master'], {
          cwd: root,
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe'],
        });
      }
    }
  } catch {
    fmt.warn('Could not switch git branches — do this manually.');
  }

  fmt.info(`Experiment ${exp.slug} reverted to dead-end. Reason: ${reason}`);
}


