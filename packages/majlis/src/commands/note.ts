import { getDb, findProjectRoot } from '../db/connection.js';
import { getActiveSession, getExperimentBySlug, getLatestExperiment, insertNote } from '../db/queries.js';
import { getFlagValue } from '../config.js';
import * as fmt from '../output/format.js';

export async function note(args: string[]): Promise<void> {
  const root = findProjectRoot();
  if (!root) throw new Error('Not in a Majlis project. Run `majlis init` first.');

  const db = getDb(root);

  const content = args.filter(a => !a.startsWith('--')).join(' ');
  if (!content) {
    throw new Error(
      'Usage: majlis note "text" [--tag <tag>] [--experiment <slug>]',
    );
  }

  const tag = getFlagValue(args, '--tag');
  const expSlug = getFlagValue(args, '--experiment');

  const session = getActiveSession(db);

  let experimentId: number | null = null;
  if (expSlug) {
    const exp = getExperimentBySlug(db, expSlug);
    if (!exp) throw new Error(`Experiment not found: ${expSlug}`);
    experimentId = exp.id;
  } else {
    const latest = getLatestExperiment(db);
    experimentId = latest?.id ?? null;
  }

  insertNote(db, session?.id ?? null, experimentId, tag ?? null, content);
  fmt.success(`Note saved${tag ? ` [${tag}]` : ''}${expSlug ? ` → ${expSlug}` : ''}`);
}
