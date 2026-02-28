import type Database from 'better-sqlite3';
import { openDbAt } from '../db/connection.js';
import type { WorktreeInfo, SwarmExperimentResult, SwarmSummary } from './types.js';
import type { Grade } from '../state/types.js';
import { GRADE_ORDER } from '../state/types.js';
import * as fmt from '../output/format.js';

/**
 * Child tables that reference experiment_id. Order doesn't matter for import.
 */
const CHILD_TABLES = [
  'decisions',
  'doubts',
  'challenges',
  'verifications',
  'metrics',
  'dead_ends',
  'reframes',
  'findings',
] as const;

/**
 * Import a single experiment and all its child records from a worktree DB
 * into the main DB. Slug is used as the unique key. IDs are remapped.
 *
 * Returns the new experiment ID in the target DB.
 */
export function importExperimentFromWorktree(
  sourceDb: Database.Database,
  targetDb: Database.Database,
  slug: string,
): number {
  const sourceExp = sourceDb.prepare(
    'SELECT * FROM experiments WHERE slug = ?',
  ).get(slug) as Record<string, unknown> | undefined;

  if (!sourceExp) {
    throw new Error(`Experiment ${slug} not found in source DB`);
  }

  const sourceId = sourceExp.id as number;

  // Insert experiment into target (new auto-increment ID, slug stays same)
  const insertExp = targetDb.prepare(`
    INSERT INTO experiments (slug, branch, status, classification_ref, sub_type,
      hypothesis, builder_guidance, depends_on, context_files,
      gate_rejection_reason, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const result = insertExp.run(
    sourceExp.slug, sourceExp.branch, sourceExp.status,
    sourceExp.classification_ref, sourceExp.sub_type,
    sourceExp.hypothesis, sourceExp.builder_guidance,
    sourceExp.depends_on ?? null, sourceExp.context_files ?? null,
    sourceExp.gate_rejection_reason ?? null,
    sourceExp.created_at, sourceExp.updated_at,
  );
  const targetId = result.lastInsertRowid as number;

  // Import child tables with remapped experiment_id
  for (const table of CHILD_TABLES) {
    importChildTable(sourceDb, targetDb, table, sourceId, targetId);
  }

  // sub_type_failures uses experiment_id too
  const stfRows = sourceDb.prepare(
    'SELECT * FROM sub_type_failures WHERE experiment_id = ?',
  ).all(sourceId) as Array<Record<string, unknown>>;

  for (const row of stfRows) {
    targetDb.prepare(`
      INSERT INTO sub_type_failures (sub_type, experiment_id, grade, created_at)
      VALUES (?, ?, ?, ?)
    `).run(row.sub_type, targetId, row.grade, row.created_at);
  }

  return targetId;
}

/**
 * Import all rows from a child table for a given experiment, remapping the FK.
 */
function importChildTable(
  sourceDb: Database.Database,
  targetDb: Database.Database,
  table: string,
  sourceExpId: number,
  targetExpId: number,
): void {
  const rows = sourceDb.prepare(
    `SELECT * FROM ${table} WHERE experiment_id = ?`,
  ).all(sourceExpId) as Array<Record<string, unknown>>;

  if (rows.length === 0) return;

  // Get column names from the first row, excluding 'id' (auto-increment)
  const cols = Object.keys(rows[0]).filter(c => c !== 'id');
  const placeholders = cols.map(() => '?').join(', ');
  const insert = targetDb.prepare(
    `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders})`,
  );

  for (const row of rows) {
    const values = cols.map(c =>
      c === 'experiment_id' ? targetExpId : row[c],
    );
    insert.run(...values);
  }
}

/**
 * Grade ranking for sorting experiments. Lower index = better.
 */
const GRADE_RANK: Record<string, number> = {
  sound: 0,
  good: 1,
  weak: 2,
  rejected: 3,
};

/**
 * Aggregate all swarm experiment results:
 * - Import each worktree's experiment data into the main DB
 * - Determine the best experiment
 * - Return a summary for the orchestrator
 */
export function aggregateSwarmResults(
  mainRoot: string,
  mainDb: Database.Database,
  results: SwarmExperimentResult[],
): SwarmSummary {
  let mergedCount = 0;
  let deadEndCount = 0;
  let errorCount = 0;
  let totalCostUsd = 0;

  // Import all experiments into main DB
  for (const r of results) {
    totalCostUsd += r.costUsd;

    if (r.error || !r.experiment) {
      errorCount++;
      continue;
    }

    try {
      // Open the worktree DB and import
      const sourceDb = openDbAt(r.worktree.path);
      mainDb.transaction(() => {
        importExperimentFromWorktree(sourceDb, mainDb, r.worktree.slug);
      })();
      sourceDb.close();

      if (r.finalStatus === 'merged') mergedCount++;
      else if (r.finalStatus === 'dead_end') deadEndCount++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      fmt.warn(`Failed to import ${r.worktree.slug}: ${msg}`);
      errorCount++;
    }
  }

  // Determine the best experiment (sound > good > weak > rejected > error)
  const ranked = results
    .filter(r => r.overallGrade && !r.error)
    .sort((a, b) => {
      const aRank = GRADE_RANK[a.overallGrade!] ?? 99;
      const bRank = GRADE_RANK[b.overallGrade!] ?? 99;
      return aRank - bRank;
    });

  const best = ranked.length > 0 ? ranked[0] : null;

  return {
    goal: '', // filled by caller
    parallelCount: results.length,
    results,
    bestExperiment: best,
    totalCostUsd,
    mergedCount,
    deadEndCount,
    errorCount,
  };
}
