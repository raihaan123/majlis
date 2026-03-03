import { getDb, findProjectRoot } from '../db/connection.js';
import { getActiveSession, insertJournalEntry } from '../db/queries.js';
import * as fmt from '../output/format.js';

export async function journal(args: string[]): Promise<void> {
  const root = findProjectRoot();
  if (!root) throw new Error('Not in a Majlis project. Run `majlis init` first.');

  const db = getDb(root);

  const content = args.filter(a => !a.startsWith('--')).join(' ');
  if (!content) {
    throw new Error('Usage: majlis journal "text"');
  }

  const session = getActiveSession(db);

  insertJournalEntry(db, session?.id ?? null, content);
  fmt.success(`Journal entry saved (${new Date().toLocaleTimeString()})`);
}
