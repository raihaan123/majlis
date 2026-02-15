import { getDb, findProjectRoot } from '../db/connection.js';
import {
  startSession,
  endSession,
  getActiveSession,
  getLatestExperiment,
} from '../db/queries.js';
import * as fmt from '../output/format.js';

export async function session(args: string[]): Promise<void> {
  const subcommand = args[0];

  if (!subcommand || (subcommand !== 'start' && subcommand !== 'end')) {
    throw new Error('Usage: majlis session start "intent" | majlis session end');
  }

  const root = findProjectRoot();
  if (!root) throw new Error('Not in a Majlis project. Run `majlis init` first.');

  const db = getDb(root);

  if (subcommand === 'start') {
    const intent = args.slice(1).filter(a => !a.startsWith('--')).join(' ');
    if (!intent) {
      throw new Error('Usage: majlis session start "intent"');
    }

    // Check for existing active session
    const existing = getActiveSession(db);
    if (existing) {
      fmt.warn(`Session already active: "${existing.intent}" (started ${existing.started_at})`);
      fmt.warn('End it first with `majlis session end`.');
      return;
    }

    // Link to current experiment if any
    const latestExp = getLatestExperiment(db);
    const sess = startSession(db, intent, latestExp?.id ?? null);
    fmt.success(`Session started: "${intent}" (id: ${sess.id})`);

    if (latestExp) {
      fmt.info(`Linked to experiment: ${latestExp.slug} (${latestExp.status})`);
    }
  } else {
    // End session
    const active = getActiveSession(db);
    if (!active) {
      throw new Error('No active session to end.');
    }

    // Parse flags
    const accomplishedIdx = args.indexOf('--accomplished');
    const accomplished = accomplishedIdx >= 0 ? args[accomplishedIdx + 1] : null;

    const unfinishedIdx = args.indexOf('--unfinished');
    const unfinished = unfinishedIdx >= 0 ? args[unfinishedIdx + 1] : null;

    const fragilityIdx = args.indexOf('--fragility');
    const fragility = fragilityIdx >= 0 ? args[fragilityIdx + 1] : null;

    endSession(db, active.id, accomplished, unfinished, fragility);
    fmt.success(`Session ended: "${active.intent}"`);

    if (accomplished) fmt.info(`Accomplished: ${accomplished}`);
    if (unfinished) fmt.info(`Unfinished: ${unfinished}`);
    if (fragility) fmt.warn(`New fragility: ${fragility}`);
  }
}
