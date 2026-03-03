import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync, execFileSync } from 'node:child_process';
import { getDb, findProjectRoot } from '../db/connection.js';
import {
  createExperiment,
  getExperimentBySlug,
  getActiveSession,
  getJournalBySession,
  insertMetric,
} from '../db/queries.js';
import { adminTransitionAndPersist } from '../state/machine.js';
import { ExperimentStatus } from '../state/types.js';
import { loadConfig, getFlagValue } from '../config.js';
import { generateSlug } from '../agents/spawn.js';
import { parseMetricsOutput } from '../metrics.js';
import { autoCommit } from '../git.js';
import { expDocRelPath } from './cycle.js';
import * as fmt from '../output/format.js';

export async function catchUp(args: string[]): Promise<void> {
  const root = findProjectRoot();
  if (!root) throw new Error('Not in a Majlis project. Run `majlis init` first.');

  const db = getDb(root);

  // Parse description from non-flag arguments
  const description = args.filter(a => !a.startsWith('--')).join(' ');
  if (!description) {
    throw new Error('Usage: majlis catch-up "description of what was done"');
  }

  // Parse flags
  const subType = getFlagValue(args, '--sub-type') ?? null;
  const diffRange = getFlagValue(args, '--diff');
  if (!diffRange) {
    throw new Error('--diff is required for catch-up. Example: --diff HEAD~3..HEAD or --diff main..my-branch');
  }

  // Get diff stat for the experiment doc
  let diffStat = '';
  try {
    diffStat = execFileSync('git', ['diff', '--stat', diffRange], {
      cwd: root, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch {
    fmt.warn(`Could not get diff stat for range ${diffRange}.`);
  }

  // Generate slug via Haiku
  let slug = await generateSlug(description, root);

  // Dedup slug (same pattern as experiment.ts)
  let attempt = 0;
  while (getExperimentBySlug(db, slug + (attempt ? `-${attempt}` : ''))) {
    attempt++;
  }
  if (attempt > 0) slug = `${slug}-${attempt}`;

  // Get experiment number
  const allExps = db.prepare('SELECT COUNT(*) as count FROM experiments').get() as { count: number };
  const num = allExps.count + 1;

  // Create experiment — use 'catch-up' as branch since there's no real branch
  const exp = createExperiment(db, slug, 'catch-up', description, subType, null, null, null);

  // Set provenance
  db.prepare('UPDATE experiments SET provenance = ? WHERE id = ?').run('catch-up', exp.id);

  // Build journal section from active session, if any
  let journalSection = '';
  const session = getActiveSession(db);
  if (session) {
    const entries = getJournalBySession(db, session.id);
    if (entries.length > 0) {
      journalSection = entries.map(e => `- [${e.created_at}] ${e.content}`).join('\n');
    }
  }

  // Auto-generate experiment doc skeleton
  const docContent = [
    `# ${description}`,
    '',
    `- Branch: catch-up (retroactive)`,
    `- Status: built (catch-up)`,
    `- Sub-type: ${subType ?? 'unclassified'}`,
    `- Date: ${new Date().toISOString().split('T')[0]}`,
    `- Provenance: catch-up`,
    '',
    '## Hypothesis',
    description,
    '',
    '## Approach',
    `Implemented manually (catch-up). Changes captured from \`${diffRange}\`.`,
    '',
    '## Files Changed',
    diffStat || '(no diff stat available)',
    '',
    '## Journal',
    journalSection || '(no journal entries)',
    '',
  ].join('\n');

  // Write experiment doc
  const docRelPath = `docs/experiments/${String(exp.id).padStart(3, '0')}-${slug}.md`;
  const docFullPath = path.join(root, docRelPath);
  const docsDir = path.dirname(docFullPath);
  if (!fs.existsSync(docsDir)) {
    fs.mkdirSync(docsDir, { recursive: true });
  }
  fs.writeFileSync(docFullPath, docContent);

  // Auto-commit
  autoCommit(root, `catch-up: ${slug}`);

  // Capture metrics if configured
  const config = loadConfig(root);
  if (config.metrics?.command) {
    try {
      const output = execSync(config.metrics.command, {
        cwd: root, encoding: 'utf-8', timeout: 60_000,
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();
      const parsed = parseMetricsOutput(output);
      for (const m of parsed) {
        insertMetric(db, exp.id, 'after', m.fixture, m.metric_name, m.metric_value);
      }
      if (parsed.length > 0) fmt.info(`Captured ${parsed.length} metric(s).`);
    } catch {
      fmt.warn('Could not capture metrics.');
    }
  }

  // Admin transition: classified → built (bootstrap)
  adminTransitionAndPersist(db, exp.id, ExperimentStatus.CLASSIFIED, ExperimentStatus.BUILT, 'bootstrap');

  fmt.success(`Catch-up experiment created: ${slug} (now at 'built')`);
  fmt.info(`Run \`majlis doubt\` when ready to evaluate.`);
}
