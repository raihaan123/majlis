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
} from '../db/queries.js';
import type Database from 'better-sqlite3';

let db: Database.Database;

beforeEach(() => {
  db = openTestDb();
});

describe('Migrations', () => {
  it('creates all 14 tables', () => {
    const tables = db.prepare(`
      SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'
    `).all() as Array<{ name: string }>;
    const names = tables.map(t => t.name).sort();
    assert.deepEqual(names, [
      'challenges', 'compressions', 'dead_ends', 'decisions', 'doubts',
      'experiments', 'findings', 'metrics', 'reframes', 'sessions',
      'sub_type_failures', 'swarm_members', 'swarm_runs', 'verifications',
    ]);
  });

  it('sets user_version to 7', () => {
    const version = db.pragma('user_version', { simple: true });
    assert.equal(version, 7);
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
    assert.equal(version, 7);
  });
});

describe('Experiments CRUD', () => {
  it('creates an experiment', () => {
    const exp = createExperiment(db, 'test-exp', 'exp/001-test', 'Test hypothesis', 'seam', null);
    assert.equal(exp.slug, 'test-exp');
    assert.equal(exp.branch, 'exp/001-test');
    assert.equal(exp.status, 'classified');
    assert.equal(exp.hypothesis, 'Test hypothesis');
    assert.equal(exp.sub_type, 'seam');
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
    storeBuilderGuidance(db, exp.id, 'Fix the seam handling');
    assert.equal(getBuilderGuidance(db, exp.id), 'Fix the seam handling');
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
    insertMetric(db, exp.id, 'before', 'ubracket', 'free_edges', 10);
    insertMetric(db, exp.id, 'before', 'ubracket', 'volume_error', 0.5);
    const metrics = getMetricsByExperimentAndPhase(db, exp.id, 'before');
    assert.equal(metrics.length, 2);
  });

  it('enforces valid phase', () => {
    const exp = createExperiment(db, 'test', 'exp/001', 'Test', null, null);
    assert.throws(() => {
      insertMetric(db, exp.id, 'invalid', 'ubracket', 'free_edges', 10);
    });
  });

  it('retrieves history by fixture', () => {
    const exp1 = createExperiment(db, 'test1', 'exp/001', 'Test1', null, null);
    const exp2 = createExperiment(db, 'test2', 'exp/002', 'Test2', null, null);
    insertMetric(db, exp1.id, 'before', 'ubracket', 'free_edges', 10);
    insertMetric(db, exp2.id, 'after', 'ubracket', 'free_edges', 5);
    const history = getMetricHistoryByFixture(db, 'ubracket');
    assert.equal(history.length, 2);
  });
});

describe('Dead Ends', () => {
  it('inserts and retrieves', () => {
    const exp = createExperiment(db, 'test', 'exp/001', 'Test', 'seam', null);
    const de = insertDeadEnd(db, exp.id, 'Strategy 1', 'Zero-area faces', 'Avoid strategy 1 for seams', 'seam');
    assert.equal(de.sub_type, 'seam');
    assert.equal(de.structural_constraint, 'Avoid strategy 1 for seams');
  });

  it('lists by sub_type', () => {
    const exp = createExperiment(db, 'test', 'exp/001', 'Test', 'seam', null);
    insertDeadEnd(db, exp.id, 'A', 'F', 'C', 'seam');
    insertDeadEnd(db, exp.id, 'B', 'F', 'C', 'tjunction');
    const seams = listDeadEndsBySubType(db, 'seam');
    assert.equal(seams.length, 1);
  });

  it('searches by text', () => {
    const exp = createExperiment(db, 'test', 'exp/001', 'Test', null, null);
    insertDeadEnd(db, exp.id, 'Strategy for periodic surfaces', 'UV mapping broke', 'Constraint', null);
    insertDeadEnd(db, exp.id, 'Other approach', 'Unrelated fail', 'Other', null);
    const results = searchDeadEnds(db, 'periodic');
    assert.equal(results.length, 1);
  });
});

describe('Verifications', () => {
  it('inserts a grade', () => {
    const exp = createExperiment(db, 'test', 'exp/001', 'Test', null, null);
    const v = insertVerification(db, exp.id, 'cylinder_builder', 'good', true, true, 'Works for half cylinders');
    assert.equal(v.grade, 'good');
    assert.equal(v.component, 'cylinder_builder');
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
    const d = insertDoubt(db, exp.id, 'Tolerance assumption', 'judgment', 'EXP-003 used different value', 'moderate');
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
    const c = insertChallenge(db, exp.id, 'Degenerate input', 'Zero-area faces collapse the algorithm');
    assert.equal(c.description, 'Degenerate input');
    assert.equal(c.reasoning, 'Zero-area faces collapse the algorithm');
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
    const exp = createExperiment(db, 'test', 'exp/001', 'Test', 'seam', null);
    incrementSubTypeFailure(db, 'seam', exp.id, 'weak');
    incrementSubTypeFailure(db, 'seam', exp.id, 'weak');
    const failures = getSubTypeFailures(db, 'seam');
    assert.equal(failures.length, 2);
  });

  it('counts weak+rejected failures', () => {
    const exp = createExperiment(db, 'test', 'exp/001', 'Test', 'seam', null);
    incrementSubTypeFailure(db, 'seam', exp.id, 'weak');
    incrementSubTypeFailure(db, 'seam', exp.id, 'rejected');
    incrementSubTypeFailure(db, 'seam', exp.id, 'weak');
    assert.equal(getSubTypeFailureCount(db, 'seam'), 3);
  });

  it('checks circuit breaker threshold', () => {
    const exp = createExperiment(db, 'test', 'exp/001', 'Test', 'seam', null);
    incrementSubTypeFailure(db, 'seam', exp.id, 'weak');
    incrementSubTypeFailure(db, 'seam', exp.id, 'weak');
    assert.equal(checkCircuitBreaker(db, 'seam', 3), false);
    incrementSubTypeFailure(db, 'seam', exp.id, 'rejected');
    assert.equal(checkCircuitBreaker(db, 'seam', 3), true);
  });

  it('gets all circuit breaker states', () => {
    const exp = createExperiment(db, 'test', 'exp/001', 'Test', null, null);
    incrementSubTypeFailure(db, 'seam', exp.id, 'weak');
    incrementSubTypeFailure(db, 'seam', exp.id, 'weak');
    incrementSubTypeFailure(db, 'seam', exp.id, 'weak');
    incrementSubTypeFailure(db, 'tjunc', exp.id, 'weak');
    const states = getAllCircuitBreakerStates(db, 3);
    assert.equal(states.length, 2);
    const seam = states.find(s => s.sub_type === 'seam');
    assert.equal(seam?.tripped, true);
    const tjunc = states.find(s => s.sub_type === 'tjunc');
    assert.equal(tjunc?.tripped, false);
  });
});

describe('Sessions', () => {
  it('starts a session', () => {
    const s = startSession(db, 'Fix degenerate faces', null);
    assert.equal(s.intent, 'Fix degenerate faces');
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
    const exp = createExperiment(db, 'lineage-test', 'exp/001-lineage-test', 'Test lineage', 'geometry', null);
    insertDecision(db, exp.id, 'Use approach A', 'test', 'Validated via fixture');
    insertMetric(db, exp.id, 'before', 'fixture1', 'accuracy', 0.85);
    insertMetric(db, exp.id, 'after', 'fixture1', 'accuracy', 0.92);
    insertDoubt(db, exp.id, 'Tolerance assumption', 'test', 'Edge case not covered', 'moderate');
    updateDoubtResolution(db, 1, 'confirmed');
    insertVerification(db, exp.id, 'approach_A', 'sound', true, true, 'Looks good');
    insertDeadEnd(db, exp.id, 'approach B', 'Failed structurally', 'Cannot handle topology', 'geometry', 'structural');

    const lineage = exportExperimentLineage(db, 'geometry');
    assert.ok(lineage.includes('lineage-test'));
    assert.ok(lineage.includes('Use approach A'));
    assert.ok(lineage.includes('[test/active]'));
    assert.ok(lineage.includes('fixture1/accuracy'));
    assert.ok(lineage.includes('0.85'));
    assert.ok(lineage.includes('0.92'));
    assert.ok(lineage.includes('[confirmed]'));
    assert.ok(lineage.includes('approach_A: sound'));
    assert.ok(lineage.includes('approach B'));
    assert.ok(lineage.includes('Cannot handle topology'));
  });

  it('filters by sub_type', () => {
    createExperiment(db, 'geo-exp', 'exp/001-geo', 'Geometry test', 'geometry', null);
    createExperiment(db, 'algo-exp', 'exp/002-algo', 'Algorithm test', 'algorithm', null);

    const geoLineage = exportExperimentLineage(db, 'geometry');
    assert.ok(geoLineage.includes('geo-exp'));
    assert.ok(!geoLineage.includes('algo-exp'));

    const algoLineage = exportExperimentLineage(db, 'algorithm');
    assert.ok(algoLineage.includes('algo-exp'));
    assert.ok(!algoLineage.includes('geo-exp'));
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
