import { describe, it, beforeEach } from 'node:test';
import * as assert from 'node:assert/strict';
import { openTestDb } from '../db/connection.js';
import {
  createExperiment,
  getExperimentById,
  getExperimentBySlug,
  updateExperimentStatus,
  listActiveExperiments,
  storeBuilderGuidance,
  getBuilderGuidance,
  insertDecision,
  listDecisionsByExperiment,
  listDecisionsByLevel,
  overturnDecision,
  insertMetric,
  getMetricsByExperimentAndPhase,
  getMetricHistoryByFixture,
  insertDeadEnd,
  listDeadEndsBySubType,
  listAllDeadEnds,
  searchDeadEnds,
  insertVerification,
  getVerificationsByExperiment,
  insertDoubt,
  getDoubtsByExperiment,
  updateDoubtResolution,
  hasDoubts,
  hasChallenges,
  insertChallenge,
  getChallengesByExperiment,
  getConfirmedDoubts,
  incrementSubTypeFailure,
  getSubTypeFailures,
  getSubTypeFailureCount,
  checkCircuitBreaker,
  getAllCircuitBreakerStates,
  startSession,
  endSession,
  getActiveSession,
  getSessionsSinceCompression,
  recordCompression,
  getLastCompression,
  exportExperimentLineage,
  exportForCompressor,
  insertNote,
  getNotesBySession,
  getNotesByExperiment,
  getRecentNotes,
  insertJournalEntry,
  getJournalBySession,
  getRecentJournal,
  storeHypothesisFile,
  findDependents,
  setChainWeakened,
  clearChainWeakened,
  cascadeChainInvalidation,
  insertObjectiveHistory,
  getObjectiveHistory,
  insertAuditProposal,
  getPendingAuditProposal,
  resolveAuditProposal,
} from '../db/queries.js';
import type Database from 'better-sqlite3';

let db: Database.Database;

beforeEach(() => {
  db = openTestDb();
});

describe('Migrations', () => {
  it('creates all 18 tables', () => {
    const tables = db.prepare(`
      SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'
    `).all() as Array<{ name: string }>;
    const names = tables.map(t => t.name).sort();
    assert.deepEqual(names, [
      'audit_proposals', 'challenges', 'compressions', 'dead_ends', 'decisions',
      'doubts', 'experiments', 'findings', 'journal_entries', 'metrics', 'notes',
      'objective_history', 'reframes', 'sessions', 'sub_type_failures',
      'swarm_members', 'swarm_runs', 'verifications',
    ]);
  });

  it('sets user_version to 9', () => {
    const version = db.pragma('user_version', { simple: true });
    assert.equal(version, 9);
  });

  it('has builder_guidance column on experiments', () => {
    const cols = db.prepare('PRAGMA table_info(experiments)').all() as Array<{ name: string }>;
    const colNames = cols.map(c => c.name);
    assert.ok(colNames.includes('builder_guidance'));
  });

  it('has depends_on and context_files columns on experiments', () => {
    const cols = db.prepare('PRAGMA table_info(experiments)').all() as Array<{ name: string }>;
    const colNames = cols.map(c => c.name);
    assert.ok(colNames.includes('depends_on'));
    assert.ok(colNames.includes('context_files'));
  });

  it('has gate_rejection_reason column on experiments', () => {
    const cols = db.prepare('PRAGMA table_info(experiments)').all() as Array<{ name: string }>;
    const colNames = cols.map(c => c.name);
    assert.ok(colNames.includes('gate_rejection_reason'));
  });

  it('is idempotent', () => {
    const db2 = openTestDb();
    const version = db2.pragma('user_version', { simple: true });
    assert.equal(version, 9);
  });
});

describe('Experiments CRUD', () => {
  it('creates an experiment', () => {
    const exp = createExperiment(db, 'test-exp', 'exp/001-test', 'Test hypothesis', 'parsing', null);
    assert.equal(exp.slug, 'test-exp');
    assert.equal(exp.branch, 'exp/001-test');
    assert.equal(exp.status, 'classified');
    assert.equal(exp.hypothesis, 'Test hypothesis');
    assert.equal(exp.sub_type, 'parsing');
  });

  it('gets by id', () => {
    const created = createExperiment(db, 'test-exp', 'exp/001-test', 'Test', null, null);
    const found = getExperimentById(db, created.id);
    assert.equal(found?.slug, 'test-exp');
  });

  it('gets by slug', () => {
    createExperiment(db, 'unique-slug', 'exp/001-unique', 'Test', null, null);
    const found = getExperimentBySlug(db, 'unique-slug');
    assert.equal(found?.branch, 'exp/001-unique');
  });

  it('returns undefined for missing experiment', () => {
    assert.equal(getExperimentById(db, 999), undefined);
    assert.equal(getExperimentBySlug(db, 'nonexistent'), undefined);
  });

  it('updates status', () => {
    const exp = createExperiment(db, 'test-exp', 'exp/001-test', 'Test', null, null);
    updateExperimentStatus(db, exp.id, 'building');
    const updated = getExperimentById(db, exp.id);
    assert.equal(updated?.status, 'building');
  });

  it('lists active experiments', () => {
    createExperiment(db, 'active-1', 'exp/001', 'Test 1', null, null);
    createExperiment(db, 'active-2', 'exp/002', 'Test 2', null, null);
    const exp3 = createExperiment(db, 'merged-1', 'exp/003', 'Test 3', null, null);
    updateExperimentStatus(db, exp3.id, 'merged');

    const active = listActiveExperiments(db);
    assert.equal(active.length, 2);
  });

  it('enforces unique slug', () => {
    createExperiment(db, 'unique', 'exp/001', 'Test', null, null);
    assert.throws(() => {
      createExperiment(db, 'unique', 'exp/002', 'Test 2', null, null);
    });
  });

  it('stores and retrieves builder guidance', () => {
    const exp = createExperiment(db, 'test', 'exp/001', 'Test', null, null);
    storeBuilderGuidance(db, exp.id, 'Fix the retry logic');
    assert.equal(getBuilderGuidance(db, exp.id), 'Fix the retry logic');
  });
});

describe('Decisions', () => {
  it('inserts a decision with evidence level', () => {
    const exp = createExperiment(db, 'test', 'exp/001', 'Test', null, null);
    const dec = insertDecision(db, exp.id, 'Use strategy 2', 'judgment', 'Best approach');
    assert.equal(dec.evidence_level, 'judgment');
    assert.equal(dec.status, 'active');
  });

  it('enforces valid evidence levels', () => {
    const exp = createExperiment(db, 'test', 'exp/001', 'Test', null, null);
    assert.throws(() => {
      insertDecision(db, exp.id, 'Test', 'invalid_level', 'Bad');
    });
  });

  it('lists by experiment', () => {
    const exp = createExperiment(db, 'test', 'exp/001', 'Test', null, null);
    insertDecision(db, exp.id, 'Dec 1', 'judgment', 'Reason 1');
    insertDecision(db, exp.id, 'Dec 2', 'test', 'Reason 2');
    const decs = listDecisionsByExperiment(db, exp.id);
    assert.equal(decs.length, 2);
  });

  it('lists by evidence level', () => {
    const exp = createExperiment(db, 'test', 'exp/001', 'Test', null, null);
    insertDecision(db, exp.id, 'Dec 1', 'judgment', 'Reason 1');
    insertDecision(db, exp.id, 'Dec 2', 'judgment', 'Reason 2');
    insertDecision(db, exp.id, 'Dec 3', 'test', 'Reason 3');
    const judgments = listDecisionsByLevel(db, 'judgment');
    assert.equal(judgments.length, 2);
  });

  it('overturns a decision', () => {
    const exp = createExperiment(db, 'test', 'exp/001', 'Test', null, null);
    const dec1 = insertDecision(db, exp.id, 'Dec 1', 'judgment', 'Reason');
    const dec2 = insertDecision(db, exp.id, 'Dec 2', 'test', 'Better reason');
    overturnDecision(db, dec1.id, dec2.id);
    const updated = db.prepare('SELECT * FROM decisions WHERE id = ?').get(dec1.id) as any;
    assert.equal(updated.status, 'overturned');
    assert.equal(updated.overturned_by, dec2.id);
  });
});

describe('Metrics', () => {
  it('inserts and retrieves by experiment+phase', () => {
    const exp = createExperiment(db, 'test', 'exp/001', 'Test', null, null);
    insertMetric(db, exp.id, 'before', 'benchmark_a', 'error_count', 10);
    insertMetric(db, exp.id, 'before', 'benchmark_a', 'latency_ms', 0.5);
    const metrics = getMetricsByExperimentAndPhase(db, exp.id, 'before');
    assert.equal(metrics.length, 2);
  });

  it('enforces valid phase', () => {
    const exp = createExperiment(db, 'test', 'exp/001', 'Test', null, null);
    assert.throws(() => {
      insertMetric(db, exp.id, 'invalid', 'benchmark_a', 'error_count', 10);
    });
  });

  it('retrieves history by fixture', () => {
    const exp1 = createExperiment(db, 'test1', 'exp/001', 'Test1', null, null);
    const exp2 = createExperiment(db, 'test2', 'exp/002', 'Test2', null, null);
    insertMetric(db, exp1.id, 'before', 'benchmark_a', 'error_count', 10);
    insertMetric(db, exp2.id, 'after', 'benchmark_a', 'error_count', 5);
    const history = getMetricHistoryByFixture(db, 'benchmark_a');
    assert.equal(history.length, 2);
  });
});

describe('Dead Ends', () => {
  it('inserts and retrieves', () => {
    const exp = createExperiment(db, 'test', 'exp/001', 'Test', 'parsing', null);
    const de = insertDeadEnd(db, exp.id, 'Strategy 1', 'Timeout on large input', 'Avoid strategy 1 for parsing', 'parsing');
    assert.equal(de.sub_type, 'parsing');
    assert.equal(de.structural_constraint, 'Avoid strategy 1 for parsing');
  });

  it('lists by sub_type', () => {
    const exp = createExperiment(db, 'test', 'exp/001', 'Test', 'parsing', null);
    insertDeadEnd(db, exp.id, 'A', 'F', 'C', 'parsing');
    insertDeadEnd(db, exp.id, 'B', 'F', 'C', 'indexing');
    const results = listDeadEndsBySubType(db, 'parsing');
    assert.equal(results.length, 1);
  });

  it('searches by text', () => {
    const exp = createExperiment(db, 'test', 'exp/001', 'Test', null, null);
    insertDeadEnd(db, exp.id, 'Strategy for batch processing', 'Queue overflow broke', 'Constraint', null);
    insertDeadEnd(db, exp.id, 'Other approach', 'Unrelated fail', 'Other', null);
    const results = searchDeadEnds(db, 'batch');
    assert.equal(results.length, 1);
  });
});

describe('Verifications', () => {
  it('inserts a grade', () => {
    const exp = createExperiment(db, 'test', 'exp/001', 'Test', null, null);
    const v = insertVerification(db, exp.id, 'query_planner', 'good', true, true, 'Works for small datasets');
    assert.equal(v.grade, 'good');
    assert.equal(v.component, 'query_planner');
  });

  it('enforces valid grades', () => {
    const exp = createExperiment(db, 'test', 'exp/001', 'Test', null, null);
    assert.throws(() => {
      insertVerification(db, exp.id, 'comp', 'invalid_grade', null, null, null);
    });
  });

  it('retrieves by experiment', () => {
    const exp = createExperiment(db, 'test', 'exp/001', 'Test', null, null);
    insertVerification(db, exp.id, 'comp1', 'sound', true, true, null);
    insertVerification(db, exp.id, 'comp2', 'weak', false, false, 'broken');
    const vs = getVerificationsByExperiment(db, exp.id);
    assert.equal(vs.length, 2);
  });
});

describe('Doubts', () => {
  it('inserts a doubt', () => {
    const exp = createExperiment(db, 'test', 'exp/001', 'Test', null, null);
    const d = insertDoubt(db, exp.id, 'Timeout assumption', 'judgment', 'EXP-003 used different value', 'moderate');
    assert.equal(d.severity, 'moderate');
    assert.equal(d.resolution, null);
  });

  it('enforces valid severity', () => {
    const exp = createExperiment(db, 'test', 'exp/001', 'Test', null, null);
    assert.throws(() => {
      insertDoubt(db, exp.id, 'Test', 'judgment', 'Evidence', 'invalid_severity');
    });
  });

  it('updates resolution', () => {
    const exp = createExperiment(db, 'test', 'exp/001', 'Test', null, null);
    const d = insertDoubt(db, exp.id, 'Test claim', 'judgment', 'Evidence', 'critical');
    updateDoubtResolution(db, d.id, 'confirmed');
    const updated = db.prepare('SELECT resolution FROM doubts WHERE id = ?').get(d.id) as { resolution: string };
    assert.equal(updated.resolution, 'confirmed');
  });

  it('hasDoubts returns correctly', () => {
    const exp = createExperiment(db, 'test', 'exp/001', 'Test', null, null);
    assert.equal(hasDoubts(db, exp.id), false);
    insertDoubt(db, exp.id, 'Test', 'judgment', 'Ev', 'minor');
    assert.equal(hasDoubts(db, exp.id), true);
  });

  it('gets confirmed doubts', () => {
    const exp = createExperiment(db, 'test', 'exp/001', 'Test', null, null);
    const d1 = insertDoubt(db, exp.id, 'D1', 'judgment', 'E1', 'critical');
    const d2 = insertDoubt(db, exp.id, 'D2', 'judgment', 'E2', 'minor');
    updateDoubtResolution(db, d1.id, 'confirmed');
    updateDoubtResolution(db, d2.id, 'dismissed');
    const confirmed = getConfirmedDoubts(db, exp.id);
    assert.equal(confirmed.length, 1);
    assert.equal(confirmed[0].claim_doubted, 'D1');
  });
});

describe('Challenges', () => {
  it('inserts a challenge', () => {
    const exp = createExperiment(db, 'test', 'exp/001', 'Test', null, null);
    const c = insertChallenge(db, exp.id, 'Malformed input', 'Empty payloads collapse the algorithm');
    assert.equal(c.description, 'Malformed input');
    assert.equal(c.reasoning, 'Empty payloads collapse the algorithm');
    assert.equal(c.experiment_id, exp.id);
  });

  it('hasChallenges returns correctly', () => {
    const exp = createExperiment(db, 'test', 'exp/001', 'Test', null, null);
    assert.equal(hasChallenges(db, exp.id), false);
    insertChallenge(db, exp.id, 'Test challenge', 'Test reasoning');
    assert.equal(hasChallenges(db, exp.id), true);
  });

  it('gets challenges by experiment', () => {
    const exp = createExperiment(db, 'test', 'exp/001', 'Test', null, null);
    insertChallenge(db, exp.id, 'C1', 'R1');
    insertChallenge(db, exp.id, 'C2', 'R2');
    const challenges = getChallengesByExperiment(db, exp.id);
    assert.equal(challenges.length, 2);
  });
});

describe('Sub-Type Failures (Circuit Breakers)', () => {
  it('increments failures', () => {
    const exp = createExperiment(db, 'test', 'exp/001', 'Test', 'parsing', null);
    incrementSubTypeFailure(db, 'parsing', exp.id, 'weak');
    incrementSubTypeFailure(db, 'parsing', exp.id, 'weak');
    const failures = getSubTypeFailures(db, 'parsing');
    assert.equal(failures.length, 2);
  });

  it('counts weak+rejected failures', () => {
    const exp = createExperiment(db, 'test', 'exp/001', 'Test', 'parsing', null);
    incrementSubTypeFailure(db, 'parsing', exp.id, 'weak');
    incrementSubTypeFailure(db, 'parsing', exp.id, 'rejected');
    incrementSubTypeFailure(db, 'parsing', exp.id, 'weak');
    assert.equal(getSubTypeFailureCount(db, 'parsing'), 3);
  });

  it('checks circuit breaker threshold', () => {
    const exp = createExperiment(db, 'test', 'exp/001', 'Test', 'parsing', null);
    incrementSubTypeFailure(db, 'parsing', exp.id, 'weak');
    incrementSubTypeFailure(db, 'parsing', exp.id, 'weak');
    assert.equal(checkCircuitBreaker(db, 'parsing', 3), false);
    incrementSubTypeFailure(db, 'parsing', exp.id, 'rejected');
    assert.equal(checkCircuitBreaker(db, 'parsing', 3), true);
  });

  it('gets all circuit breaker states', () => {
    const exp = createExperiment(db, 'test', 'exp/001', 'Test', null, null);
    incrementSubTypeFailure(db, 'parsing', exp.id, 'weak');
    incrementSubTypeFailure(db, 'parsing', exp.id, 'weak');
    incrementSubTypeFailure(db, 'parsing', exp.id, 'weak');
    incrementSubTypeFailure(db, 'indexing', exp.id, 'weak');
    const states = getAllCircuitBreakerStates(db, 3);
    assert.equal(states.length, 2);
    const parsing = states.find(s => s.sub_type === 'parsing');
    assert.equal(parsing?.tripped, true);
    const indexing = states.find(s => s.sub_type === 'indexing');
    assert.equal(indexing?.tripped, false);
  });
});

describe('Sessions', () => {
  it('starts a session', () => {
    const s = startSession(db, 'Fix input validation', null);
    assert.equal(s.intent, 'Fix input validation');
    assert.equal(s.ended_at, null);
  });

  it('ends a session', () => {
    const s = startSession(db, 'Test', null);
    endSession(db, s.id, 'Done', 'Nothing', 'Edge cases');
    const updated = db.prepare('SELECT * FROM sessions WHERE id = ?').get(s.id) as any;
    assert.ok(updated.ended_at);
    assert.equal(updated.accomplished, 'Done');
  });

  it('gets active session', () => {
    assert.equal(getActiveSession(db), undefined);
    startSession(db, 'Test', null);
    assert.ok(getActiveSession(db));
  });

  it('counts sessions since compression', () => {
    assert.equal(getSessionsSinceCompression(db), 0);
    startSession(db, 'S1', null);
    startSession(db, 'S2', null);
    assert.equal(getSessionsSinceCompression(db), 2);
  });
});

describe('Compressions', () => {
  it('records a compression', () => {
    const c = recordCompression(db, 5, 2000, 800);
    assert.equal(c.session_count_since_last, 5);
    assert.equal(c.synthesis_size_before, 2000);
    assert.equal(c.synthesis_size_after, 800);
  });

  it('gets last compression', () => {
    assert.equal(getLastCompression(db), undefined);
    recordCompression(db, 3, 1000, 500);
    const last = getLastCompression(db);
    assert.equal(last?.session_count_since_last, 3);
  });

  it('resets session count after compression', () => {
    // Insert sessions with explicit timestamps to ensure ordering
    db.prepare("INSERT INTO sessions (intent, started_at) VALUES (?, datetime('now', '-3 seconds'))").run('S1');
    db.prepare("INSERT INTO sessions (intent, started_at) VALUES (?, datetime('now', '-2 seconds'))").run('S2');
    db.prepare("INSERT INTO sessions (intent, started_at) VALUES (?, datetime('now', '-1 seconds'))").run('S3');
    assert.equal(getSessionsSinceCompression(db), 3);
    recordCompression(db, 3, 1000, 500);
    db.prepare("INSERT INTO sessions (intent, started_at) VALUES (?, datetime('now', '+1 seconds'))").run('S4');
    assert.equal(getSessionsSinceCompression(db), 1);
  });
});

// ── Fix #1: Experiment Lineage ─────────────────────────────
describe('exportExperimentLineage()', () => {
  it('includes decisions, metrics, doubts, verifications, and dead-ends', () => {
    const exp = createExperiment(db, 'lineage-test', 'exp/001-lineage-test', 'Test lineage', 'routing', null);
    insertDecision(db, exp.id, 'Use approach A', 'test', 'Validated via fixture');
    insertMetric(db, exp.id, 'before', 'fixture1', 'accuracy', 0.85);
    insertMetric(db, exp.id, 'after', 'fixture1', 'accuracy', 0.92);
    insertDoubt(db, exp.id, 'Timeout assumption', 'test', 'Edge case not covered', 'moderate');
    updateDoubtResolution(db, 1, 'confirmed');
    insertVerification(db, exp.id, 'approach_A', 'sound', true, true, 'Looks good');
    insertDeadEnd(db, exp.id, 'approach B', 'Failed structurally', 'Cannot handle concurrency', 'routing', 'structural');

    const lineage = exportExperimentLineage(db, 'routing');
    assert.ok(lineage.includes('lineage-test'));
    assert.ok(lineage.includes('Use approach A'));
    assert.ok(lineage.includes('[test/active]'));
    assert.ok(lineage.includes('fixture1/accuracy'));
    assert.ok(lineage.includes('0.85'));
    assert.ok(lineage.includes('0.92'));
    assert.ok(lineage.includes('[confirmed]'));
    assert.ok(lineage.includes('approach_A: sound'));
    assert.ok(lineage.includes('approach B'));
    assert.ok(lineage.includes('Cannot handle concurrency'));
  });

  it('filters by sub_type', () => {
    createExperiment(db, 'route-exp', 'exp/001-route', 'Routing test', 'routing', null);
    createExperiment(db, 'algo-exp', 'exp/002-algo', 'Algorithm test', 'algorithm', null);

    const routeLineage = exportExperimentLineage(db, 'routing');
    assert.ok(routeLineage.includes('route-exp'));
    assert.ok(!routeLineage.includes('algo-exp'));

    const algoLineage = exportExperimentLineage(db, 'algorithm');
    assert.ok(algoLineage.includes('algo-exp'));
    assert.ok(!algoLineage.includes('route-exp'));
  });

  it('truncates at maxLength', () => {
    const exp = createExperiment(db, 'big-exp', 'exp/001-big', 'Big test', 'big', null);
    // Insert enough data to exceed a small limit
    for (let i = 0; i < 50; i++) {
      insertDecision(db, exp.id, `Decision ${i}: ${'x'.repeat(100)}`, 'judgment', `Justification ${i}`);
    }
    const lineage = exportExperimentLineage(db, 'big', 500);
    assert.ok(lineage.length <= 600); // some slack for truncation marker
    assert.ok(lineage.includes('LINEAGE TRUNCATED'));
  });

  it('returns empty string for no experiments', () => {
    const lineage = exportExperimentLineage(db, 'nonexistent');
    assert.equal(lineage, '');
  });
});

describe('exportForCompressor() limit', () => {
  it('defaults to 50000 character limit', () => {
    // Just verify it returns a string (the default limit is now 50K)
    const result = exportForCompressor(db);
    assert.ok(typeof result === 'string');
  });
});

describe('Migration 008: notes, journal, hypothesis_file, provenance', () => {
  it('creates notes table with correct columns', () => {
    const cols = db.prepare('PRAGMA table_info(notes)').all() as Array<{ name: string }>;
    const colNames = cols.map(c => c.name);
    assert.ok(colNames.includes('id'));
    assert.ok(colNames.includes('session_id'));
    assert.ok(colNames.includes('experiment_id'));
    assert.ok(colNames.includes('tag'));
    assert.ok(colNames.includes('content'));
    assert.ok(colNames.includes('created_at'));
  });

  it('creates journal_entries table with correct columns', () => {
    const cols = db.prepare('PRAGMA table_info(journal_entries)').all() as Array<{ name: string }>;
    const colNames = cols.map(c => c.name);
    assert.ok(colNames.includes('id'));
    assert.ok(colNames.includes('session_id'));
    assert.ok(colNames.includes('content'));
    assert.ok(colNames.includes('created_at'));
  });

  it('has hypothesis_file and provenance columns on experiments', () => {
    const cols = db.prepare('PRAGMA table_info(experiments)').all() as Array<{ name: string }>;
    const colNames = cols.map(c => c.name);
    assert.ok(colNames.includes('hypothesis_file'));
    assert.ok(colNames.includes('provenance'));
  });
});

describe('Notes', () => {
  it('inserts a note without session or experiment', () => {
    const note = insertNote(db, null, null, null, 'test observation');
    assert.ok(note.id);
    assert.equal(note.content, 'test observation');
    assert.equal(note.session_id, null);
    assert.equal(note.experiment_id, null);
    assert.equal(note.tag, null);
  });

  it('inserts a note with tag', () => {
    const note = insertNote(db, null, null, 'hypothesis', 'cluster by distance');
    assert.equal(note.tag, 'hypothesis');
    assert.equal(note.content, 'cluster by distance');
  });

  it('inserts a note with session and experiment', () => {
    const exp = createExperiment(db, 'note-test', 'exp/note', 'test', null, null);
    const session = startSession(db, 'test session', exp.id);
    const note = insertNote(db, session.id, exp.id, 'code-pointer', 'see line 42');
    assert.equal(note.session_id, session.id);
    assert.equal(note.experiment_id, exp.id);
    assert.equal(note.tag, 'code-pointer');
  });

  it('queries notes by session', () => {
    const session = startSession(db, 'notes session', null);
    insertNote(db, session.id, null, null, 'note 1');
    insertNote(db, session.id, null, null, 'note 2');
    const notes = getNotesBySession(db, session.id);
    assert.equal(notes.length, 2);
  });

  it('queries notes by experiment', () => {
    const exp = createExperiment(db, 'note-exp', 'exp/note2', 'test', null, null);
    insertNote(db, null, exp.id, null, 'exp note');
    const notes = getNotesByExperiment(db, exp.id);
    assert.equal(notes.length, 1);
    assert.equal(notes[0].content, 'exp note');
  });

  it('queries recent notes with limit', () => {
    insertNote(db, null, null, null, 'recent 1');
    insertNote(db, null, null, null, 'recent 2');
    insertNote(db, null, null, null, 'recent 3');
    const notes = getRecentNotes(db, 2);
    assert.equal(notes.length, 2);
  });
});

describe('Journal', () => {
  it('inserts a journal entry without session', () => {
    const entry = insertJournalEntry(db, null, 'trying something');
    assert.ok(entry.id);
    assert.equal(entry.content, 'trying something');
    assert.equal(entry.session_id, null);
  });

  it('inserts a journal entry with session', () => {
    const session = startSession(db, 'journal session', null);
    const entry = insertJournalEntry(db, session.id, 'it works');
    assert.equal(entry.session_id, session.id);
  });

  it('queries journal by session', () => {
    const session = startSession(db, 'journal q session', null);
    insertJournalEntry(db, session.id, 'entry 1');
    insertJournalEntry(db, session.id, 'entry 2');
    const entries = getJournalBySession(db, session.id);
    assert.equal(entries.length, 2);
  });

  it('queries recent journal entries with limit', () => {
    insertJournalEntry(db, null, 'j1');
    insertJournalEntry(db, null, 'j2');
    insertJournalEntry(db, null, 'j3');
    const entries = getRecentJournal(db, 2);
    assert.equal(entries.length, 2);
  });
});

describe('Hypothesis File', () => {
  it('stores and retrieves hypothesis file path', () => {
    const exp = createExperiment(db, 'hypo-test', 'exp/hypo', 'test', null, null);
    storeHypothesisFile(db, exp.id, 'hypothesis.md');
    const updated = getExperimentById(db, exp.id);
    assert.equal(updated!.hypothesis_file, 'hypothesis.md');
  });
});

describe('Compressor export includes notes and journal', () => {
  it('includes pilot notes section', () => {
    insertNote(db, null, null, 'observation', 'axis estimate is robust');
    const result = exportForCompressor(db);
    assert.ok(result.includes('Pilot Notes'));
    assert.ok(result.includes('axis estimate is robust'));
  });

  it('includes journal section', () => {
    insertJournalEntry(db, null, 'histogram is bimodal');
    const result = exportForCompressor(db);
    assert.ok(result.includes('Journal'));
    assert.ok(result.includes('histogram is bimodal'));
  });
});

// ── Migration 009 tests ─────────────────────────────────────

describe('Migration 009: chain_weakened_by, objective_history, audit_proposals', () => {
  it('has chain_weakened_by column on experiments', () => {
    const cols = db.prepare('PRAGMA table_info(experiments)').all() as Array<{ name: string }>;
    const colNames = cols.map(c => c.name);
    assert.ok(colNames.includes('chain_weakened_by'));
  });

  it('creates objective_history table', () => {
    const cols = db.prepare('PRAGMA table_info(objective_history)').all() as Array<{ name: string }>;
    const colNames = cols.map(c => c.name);
    assert.ok(colNames.includes('id'));
    assert.ok(colNames.includes('objective_text'));
    assert.ok(colNames.includes('previous_text'));
    assert.ok(colNames.includes('reason'));
    assert.ok(colNames.includes('source'));
    assert.ok(colNames.includes('created_at'));
  });

  it('creates audit_proposals table', () => {
    const cols = db.prepare('PRAGMA table_info(audit_proposals)').all() as Array<{ name: string }>;
    const colNames = cols.map(c => c.name);
    assert.ok(colNames.includes('id'));
    assert.ok(colNames.includes('proposed_objective'));
    assert.ok(colNames.includes('reason'));
    assert.ok(colNames.includes('audit_output'));
    assert.ok(colNames.includes('status'));
    assert.ok(colNames.includes('resolved_at'));
  });

  it('enforces valid source values on objective_history', () => {
    assert.throws(() => {
      db.prepare(`INSERT INTO objective_history (objective_text, reason, source) VALUES (?, ?, ?)`).run('obj', 'reason', 'invalid');
    });
  });

  it('enforces valid status values on audit_proposals', () => {
    assert.throws(() => {
      db.prepare(`INSERT INTO audit_proposals (proposed_objective, reason, status) VALUES (?, ?, ?)`).run('obj', 'reason', 'invalid');
    });
  });
});

// ── Chain Invalidation tests ────────────────────────────────

describe('Chain Invalidation', () => {
  it('findDependents finds direct dependents', () => {
    const upstream = createExperiment(db, 'upstream', 'exp/001-up', 'upstream', null, null);
    createExperiment(db, 'downstream', 'exp/002-down', 'downstream', null, null, 'upstream');

    const deps = findDependents(db, 'upstream');
    assert.equal(deps.length, 1);
    assert.equal(deps[0].slug, 'downstream');
  });

  it('findDependents finds transitive dependents', () => {
    createExperiment(db, 'a', 'exp/001-a', 'a', null, null);
    createExperiment(db, 'b', 'exp/002-b', 'b', null, null, 'a');
    createExperiment(db, 'c', 'exp/003-c', 'c', null, null, 'b');

    const deps = findDependents(db, 'a');
    assert.equal(deps.length, 2);
    const slugs = deps.map(d => d.slug).sort();
    assert.deepEqual(slugs, ['b', 'c']);
  });

  it('findDependents skips terminal experiments', () => {
    createExperiment(db, 'up2', 'exp/001-up2', 'up', null, null);
    const dead = createExperiment(db, 'dead-dep', 'exp/002-dead', 'dead', null, null, 'up2');
    updateExperimentStatus(db, dead.id, 'dead_end');

    const deps = findDependents(db, 'up2');
    assert.equal(deps.length, 0);
  });

  it('setChainWeakened and clearChainWeakened work', () => {
    const exp = createExperiment(db, 'chain-test', 'exp/001-ct', 'test', null, null);
    assert.equal(exp.chain_weakened_by, null);

    setChainWeakened(db, exp.id, 'some-slug');
    const updated = getExperimentById(db, exp.id);
    assert.equal(updated!.chain_weakened_by, 'some-slug');

    clearChainWeakened(db, exp.id);
    const cleared = getExperimentById(db, exp.id);
    assert.equal(cleared!.chain_weakened_by, null);
  });

  it('cascadeChainInvalidation flags all downstream', () => {
    createExperiment(db, 'root-exp', 'exp/001-root', 'root', null, null);
    createExperiment(db, 'mid-exp', 'exp/002-mid', 'mid', null, null, 'root-exp');
    createExperiment(db, 'leaf-exp', 'exp/003-leaf', 'leaf', null, null, 'mid-exp');

    const count = cascadeChainInvalidation(db, 'root-exp');
    assert.equal(count, 2);

    const mid = getExperimentBySlug(db, 'mid-exp');
    assert.equal(mid!.chain_weakened_by, 'root-exp');

    const leaf = getExperimentBySlug(db, 'leaf-exp');
    assert.equal(leaf!.chain_weakened_by, 'root-exp');
  });

  it('cascadeChainInvalidation returns 0 with no dependents', () => {
    createExperiment(db, 'solo-exp', 'exp/001-solo', 'solo', null, null);
    const count = cascadeChainInvalidation(db, 'solo-exp');
    assert.equal(count, 0);
  });
});

// ── Objective History tests ─────────────────────────────────

describe('Objective History', () => {
  it('inserts and retrieves objective history', () => {
    insertObjectiveHistory(db, 'new objective', 'old objective', 'audit found misalignment', 'audit');
    const history = getObjectiveHistory(db);
    assert.equal(history.length, 1);
    assert.equal(history[0].objective_text, 'new objective');
    assert.equal(history[0].previous_text, 'old objective');
    assert.equal(history[0].reason, 'audit found misalignment');
    assert.equal(history[0].source, 'audit');
  });

  it('inserts manual objective history', () => {
    insertObjectiveHistory(db, 'manual obj', null, 'initial setup', 'manual');
    const history = getObjectiveHistory(db);
    assert.equal(history[0].source, 'manual');
    assert.equal(history[0].previous_text, null);
  });
});

// ── Audit Proposals tests ───────────────────────────────────

describe('Audit Proposals', () => {
  it('inserts and retrieves a pending proposal', () => {
    insertAuditProposal(db, 'better objective', 'current one is wrong', 'full audit output');
    const pending = getPendingAuditProposal(db);
    assert.ok(pending);
    assert.equal(pending!.proposed_objective, 'better objective');
    assert.equal(pending!.reason, 'current one is wrong');
    assert.equal(pending!.status, 'pending');
    assert.equal(pending!.audit_output, 'full audit output');
  });

  it('resolveAuditProposal accepts', () => {
    insertAuditProposal(db, 'proposed', 'reason', null);
    const pending = getPendingAuditProposal(db);
    assert.ok(pending);
    resolveAuditProposal(db, pending!.id, 'accepted');

    const after = getPendingAuditProposal(db);
    assert.equal(after, undefined);

    const resolved = db.prepare('SELECT * FROM audit_proposals WHERE id = ?').get(pending!.id) as any;
    assert.equal(resolved.status, 'accepted');
    assert.ok(resolved.resolved_at);
  });

  it('resolveAuditProposal rejects', () => {
    insertAuditProposal(db, 'bad proposal', 'bad reason', null);
    const pending = getPendingAuditProposal(db);
    resolveAuditProposal(db, pending!.id, 'rejected');

    const after = getPendingAuditProposal(db);
    assert.equal(after, undefined);
  });

  it('returns null when no pending proposals', () => {
    const pending = getPendingAuditProposal(db);
    assert.equal(pending, undefined);
  });
});
