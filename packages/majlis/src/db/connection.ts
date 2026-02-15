import Database from 'better-sqlite3';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { runMigrations } from './migrations.js';

let _db: Database.Database | null = null;

/**
 * Walk up from startDir looking for a directory containing `.majlis/`.
 */
export function findProjectRoot(startDir?: string): string | null {
  let dir = startDir ?? process.cwd();
  const root = path.parse(dir).root;

  while (true) {
    if (fs.existsSync(path.join(dir, '.majlis'))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir || parent === root) {
      return null;
    }
    dir = parent;
  }
}

/**
 * Get the singleton database connection.
 * Opens .majlis/majlis.db with WAL mode and foreign keys.
 * Auto-runs migrations on first connection.
 *
 * Pass ':memory:' as projectRoot for testing.
 */
export function getDb(projectRoot?: string): Database.Database {
  if (_db) return _db;

  let dbPath: string;

  if (projectRoot === ':memory:') {
    dbPath = ':memory:';
  } else {
    const root = projectRoot ?? findProjectRoot();
    if (!root) {
      throw new Error(
        'Not in a Majlis project. Run `majlis init` first, or run from a directory with .majlis/'
      );
    }
    const majlisDir = path.join(root, '.majlis');
    if (!fs.existsSync(majlisDir)) {
      fs.mkdirSync(majlisDir, { recursive: true });
    }
    dbPath = path.join(majlisDir, 'majlis.db');
  }

  _db = new Database(dbPath);
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');
  runMigrations(_db);

  return _db;
}

/**
 * Close the singleton DB connection. Used in tests.
 */
export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}

/**
 * Reset the singleton — used for testing with different DBs.
 */
export function resetDb(): void {
  _db = null;
}

/**
 * Open a fresh in-memory database for testing. Does NOT set the singleton.
 */
export function openTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}
