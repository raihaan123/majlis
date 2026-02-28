import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync, execFileSync } from 'node:child_process';
import { getDb, findProjectRoot } from '../db/connection.js';
import {
  createExperiment,
  getExperimentBySlug,
  getLatestExperiment,
  insertDeadEnd,
  clearGateRejection,
  listStructuralDeadEnds,
  listStructuralDeadEndsBySubType,
} from '../db/queries.js';
import { adminTransitionAndPersist } from '../state/machine.js';
import { ExperimentStatus } from '../state/types.js';
import { loadConfig, getFlagValue, readFileOrEmpty, truncateContext, CONTEXT_LIMITS } from '../config.js';
import { generateSlug, spawnAgent } from '../agents/spawn.js';
import { autoCommit, handleDeadEndGit } from '../git.js';
import { expDocRelPath } from './cycle.js';
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
  let slug = getFlagValue(args, '--slug') ?? await generateSlug(hypothesis, root);

  // Dedup: append -2, -3, etc. if slug already exists (e.g., dead-ended experiment reused same slug)
  let attempt = 0;
  while (getExperimentBySlug(db, slug + (attempt ? `-${attempt}` : ''))) {
    attempt++;
  }
  if (attempt > 0) {
    const original = slug;
    slug = `${slug}-${attempt}`;
    fmt.info(`Slug "${original}" already exists, using "${slug}"`);
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
  const dependsOn = getFlagValue(args, '--depends-on') ?? null;
  const contextArg = getFlagValue(args, '--context') ?? null;
  const contextFiles = contextArg ? contextArg.split(',').map(f => f.trim()) : null;

  // Validate dependency exists if specified
  if (dependsOn) {
    const depExp = getExperimentBySlug(db, dependsOn);
    if (!depExp) {
      throw new Error(`Dependency experiment not found: ${dependsOn}`);
    }
    fmt.info(`Depends on: ${dependsOn} (status: ${depExp.status})`);
  }

  // Create DB entry
  const exp = createExperiment(db, slug, branch, hypothesis, subType, null, dependsOn, contextFiles);
  if (contextFiles) {
    fmt.info(`Context files: ${contextFiles.join(', ')}`);
  }
  fmt.success(`Created experiment #${exp.id}: ${exp.slug}`);

  // Create experiment log from template — use exp.id (not COUNT+1) so the path
  // matches expDocRelPath() which the builder, doubter, and verifier all use.
  const docRelPath = expDocRelPath(exp);
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
    const logPath = path.join(root, docRelPath);
    fs.writeFileSync(logPath, logContent);
    fmt.info(`Created experiment log: ${docRelPath}`);
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

  const reason = getFlagValue(args, '--reason') ?? 'Manually reverted';
  const contextArg = getFlagValue(args, '--context') ?? null;
  const contextFiles = contextArg ? contextArg.split(',').map(f => f.trim()) : [];

  // ── Post-mortem agent (runs BEFORE git checkout so branch files are readable) ──

  let whyFailed = reason;
  let structuralConstraint = `Reverted: ${reason}`;
  let category: 'structural' | 'procedural' = args.includes('--structural') ? 'structural' : 'procedural';

  try {
    // Gather context for the post-mortem agent
    const gitDiff = getGitDiff(root, exp.branch);
    const synthesis = truncateContext(
      readFileOrEmpty(path.join(root, 'docs', 'synthesis', 'current.md')),
      CONTEXT_LIMITS.synthesis,
    );
    const fragility = truncateContext(
      readFileOrEmpty(path.join(root, 'docs', 'synthesis', 'fragility.md')),
      CONTEXT_LIMITS.fragility,
    );
    const deadEnds = exp.sub_type
      ? listStructuralDeadEndsBySubType(db, exp.sub_type)
      : listStructuralDeadEnds(db);

    // Build supplementary context from --context files
    let supplementary = '';
    if (contextFiles.length > 0) {
      const sections: string[] = ['## Artifact Files (pointed to by --context)'];
      for (const relPath of contextFiles) {
        const absPath = path.join(root, relPath);
        try {
          const content = fs.readFileSync(absPath, 'utf-8');
          sections.push(`### ${relPath}\n\`\`\`\n${content.slice(0, 12000)}\n\`\`\``);
        } catch {
          sections.push(`### ${relPath}\n*(file not found)*`);
        }
      }
      supplementary = sections.join('\n\n');
    }

    // Assemble task prompt
    let taskPrompt = `Analyze this reverted experiment and produce a structured dead-end record.\n\n`;
    taskPrompt += `## Experiment\n- Slug: ${exp.slug}\n- Hypothesis: ${exp.hypothesis ?? '(none)'}\n`;
    taskPrompt += `- Status at revert: ${exp.status}\n- Sub-type: ${exp.sub_type ?? '(none)'}\n\n`;
    taskPrompt += `## User's Reason for Reverting\n${reason}\n\n`;
    if (gitDiff) {
      taskPrompt += `## Git Diff (branch vs main)\n\`\`\`diff\n${gitDiff.slice(0, 15000)}\n\`\`\`\n\n`;
    }
    if (supplementary) {
      taskPrompt += `${supplementary}\n\n`;
    }
    taskPrompt += 'Produce a specific structural constraint. Include scope (what this applies to and does NOT apply to).';

    fmt.info('Running post-mortem analysis...');
    const result = await spawnAgent('postmortem', {
      experiment: {
        id: exp.id,
        slug: exp.slug,
        hypothesis: exp.hypothesis,
        status: exp.status,
        sub_type: exp.sub_type,
        builder_guidance: null,
      },
      deadEnds: deadEnds.map(d => ({
        approach: d.approach,
        why_failed: d.why_failed,
        structural_constraint: d.structural_constraint,
      })),
      fragility,
      synthesis,
      supplementaryContext: supplementary || undefined,
      taskPrompt,
    }, root);

    // Use agent output if available, otherwise fall back to user's reason
    if (result.structured?.postmortem) {
      const pm = result.structured.postmortem;
      whyFailed = pm.why_failed;
      structuralConstraint = pm.structural_constraint;
      category = pm.category;
      fmt.success('Post-mortem analysis complete.');
    } else {
      fmt.warn('Post-mortem agent did not produce structured output. Using --reason text.');
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    fmt.warn(`Post-mortem agent failed: ${msg}. Using --reason text.`);
  }

  // ── Record dead-end and transition ──

  insertDeadEnd(db, exp.id, exp.hypothesis ?? exp.slug,
    whyFailed, structuralConstraint, exp.sub_type, category);

  // Clear stale gate rejection reason before terminal transition
  if (exp.gate_rejection_reason) clearGateRejection(db, exp.id);

  adminTransitionAndPersist(db, exp.id, exp.status as ExperimentStatus, ExperimentStatus.DEAD_END, 'revert');

  // Commit any builder changes and checkout main/master
  handleDeadEndGit(exp, root);

  fmt.info(`Experiment ${exp.slug} reverted to dead-end.`);
  fmt.info(`Constraint: ${structuralConstraint.slice(0, 120)}${structuralConstraint.length > 120 ? '...' : ''}`);
}

/**
 * Get git diff of experiment branch vs main.
 * Uses three-dot diff to show changes introduced by the branch.
 * Returns null if diff cannot be obtained.
 */
function getGitDiff(root: string, branch: string): string | null {
  try {
    return execFileSync('git', ['diff', `main...${branch}`, '--stat', '--patch'], {
      cwd: root,
      encoding: 'utf-8',
      maxBuffer: 1024 * 1024,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch {
    try {
      return execFileSync('git', ['diff', `master...${branch}`, '--stat', '--patch'], {
        cwd: root,
        encoding: 'utf-8',
        maxBuffer: 1024 * 1024,
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();
    } catch {
      return null;
    }
  }
}


