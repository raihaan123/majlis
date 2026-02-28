import type Database from 'better-sqlite3';

/**
 * Migration system using user_version pragma — no migration table needed.
 * Each migration is an array index: migration[0] upgrades from version 0 to 1, etc.
 */

type Migration = (db: Database.Database) => void;

const migrations: Migration[] = [
  // Migration 001: v0 → v1 — All 9 tables from PRD v2 §4.2
  (db) => {
    db.exec(`
      CREATE TABLE experiments (
        id INTEGER PRIMARY KEY,
        slug TEXT UNIQUE NOT NULL,
        branch TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'classified',
        classification_ref TEXT,
        sub_type TEXT,
        hypothesis TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE decisions (
        id INTEGER PRIMARY KEY,
        experiment_id INTEGER REFERENCES experiments(id),
        description TEXT NOT NULL,
        evidence_level TEXT NOT NULL CHECK(
          evidence_level IN ('proof', 'test', 'strong_consensus',
                             'consensus', 'analogy', 'judgment')
        ),
        justification TEXT NOT NULL,
        status TEXT DEFAULT 'active' CHECK(
          status IN ('active', 'overturned', 'superseded')
        ),
        overturned_by INTEGER REFERENCES decisions(id),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE metrics (
        id INTEGER PRIMARY KEY,
        experiment_id INTEGER REFERENCES experiments(id),
        phase TEXT NOT NULL CHECK(phase IN ('before', 'after')),
        fixture TEXT NOT NULL,
        metric_name TEXT NOT NULL,
        metric_value REAL NOT NULL,
        captured_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE dead_ends (
        id INTEGER PRIMARY KEY,
        experiment_id INTEGER REFERENCES experiments(id),
        approach TEXT NOT NULL,
        why_failed TEXT NOT NULL,
        structural_constraint TEXT NOT NULL,
        sub_type TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE verifications (
        id INTEGER PRIMARY KEY,
        experiment_id INTEGER REFERENCES experiments(id),
        component TEXT NOT NULL,
        grade TEXT NOT NULL CHECK(
          grade IN ('sound', 'good', 'weak', 'rejected')
        ),
        provenance_intact BOOLEAN,
        content_correct BOOLEAN,
        notes TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE doubts (
        id INTEGER PRIMARY KEY,
        experiment_id INTEGER REFERENCES experiments(id),
        claim_doubted TEXT NOT NULL,
        evidence_level_of_claim TEXT NOT NULL,
        evidence_for_doubt TEXT NOT NULL,
        severity TEXT NOT NULL CHECK(severity IN ('minor', 'moderate', 'critical')),
        resolution TEXT CHECK(resolution IN ('confirmed', 'dismissed', 'inconclusive')),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE sub_type_failures (
        sub_type TEXT NOT NULL,
        experiment_id INTEGER REFERENCES experiments(id),
        grade TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE sessions (
        id INTEGER PRIMARY KEY,
        intent TEXT NOT NULL,
        experiment_id INTEGER REFERENCES experiments(id),
        started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        ended_at DATETIME,
        accomplished TEXT,
        unfinished TEXT,
        new_fragility TEXT
      );

      CREATE TABLE compressions (
        id INTEGER PRIMARY KEY,
        session_count_since_last INTEGER,
        synthesis_size_before INTEGER,
        synthesis_size_after INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX idx_decisions_evidence ON decisions(evidence_level);
      CREATE INDEX idx_decisions_experiment ON decisions(experiment_id);
      CREATE INDEX idx_metrics_experiment ON metrics(experiment_id, fixture);
      CREATE INDEX idx_dead_ends_sub_type ON dead_ends(sub_type);
      CREATE INDEX idx_sub_type_failures ON sub_type_failures(sub_type);
    `);
  },

  // Migration 002: v1 → v2 — Add builder_guidance column to experiments
  (db) => {
    db.exec(`
      ALTER TABLE experiments ADD COLUMN builder_guidance TEXT;
    `);
  },

  // Migration 003: v2 → v3 — Add challenges table
  (db) => {
    db.exec(`
      CREATE TABLE challenges (
        id INTEGER PRIMARY KEY,
        experiment_id INTEGER REFERENCES experiments(id),
        description TEXT NOT NULL,
        reasoning TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX idx_challenges_experiment ON challenges(experiment_id);
    `);
  },

  // Migration 004: v3 → v4 — Reframes, findings tables; dead-end classification
  (db) => {
    db.exec(`
      CREATE TABLE reframes (
        id INTEGER PRIMARY KEY,
        experiment_id INTEGER REFERENCES experiments(id),
        decomposition TEXT NOT NULL,
        divergences TEXT NOT NULL,
        recommendation TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX idx_reframes_experiment ON reframes(experiment_id);

      CREATE TABLE findings (
        id INTEGER PRIMARY KEY,
        experiment_id INTEGER REFERENCES experiments(id),
        approach TEXT NOT NULL,
        source TEXT NOT NULL,
        relevance TEXT NOT NULL,
        contradicts_current BOOLEAN NOT NULL DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX idx_findings_experiment ON findings(experiment_id);

      ALTER TABLE dead_ends ADD COLUMN category TEXT DEFAULT 'structural'
        CHECK(category IN ('structural', 'procedural'));
    `);
  },

  // Migration 005: v4 → v5 — Swarm tracking tables
  (db) => {
    db.exec(`
      CREATE TABLE swarm_runs (
        id INTEGER PRIMARY KEY,
        goal TEXT NOT NULL,
        parallel_count INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'running'
          CHECK(status IN ('running', 'completed', 'failed')),
        total_cost_usd REAL DEFAULT 0,
        best_experiment_slug TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        completed_at DATETIME
      );

      CREATE TABLE swarm_members (
        id INTEGER PRIMARY KEY,
        swarm_run_id INTEGER REFERENCES swarm_runs(id),
        experiment_slug TEXT NOT NULL,
        worktree_path TEXT NOT NULL,
        final_status TEXT,
        overall_grade TEXT,
        cost_usd REAL DEFAULT 0,
        error TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX idx_swarm_members_run ON swarm_members(swarm_run_id);
    `);
  },

  // Migration 006: v5 → v6 — Experiment dependencies and scoped context
  (db) => {
    db.exec(`
      ALTER TABLE experiments ADD COLUMN depends_on TEXT;
      ALTER TABLE experiments ADD COLUMN context_files TEXT;
    `);
  },

  // Migration 007: v6 → v7 — Gate rejection reason (pause instead of auto-kill)
  (db) => {
    db.exec(`
      ALTER TABLE experiments ADD COLUMN gate_rejection_reason TEXT;
    `);
  },
];

/**
 * Run all pending migrations. Uses user_version pragma for tracking.
 */
export function runMigrations(db: Database.Database): void {
  const currentVersion = db.pragma('user_version', { simple: true }) as number;

  for (let i = currentVersion; i < migrations.length; i++) {
    db.transaction(() => {
      migrations[i](db);
      db.pragma(`user_version = ${i + 1}`);
    })();
  }
}
