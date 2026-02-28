import { describe, it, beforeEach } from 'node:test';
import * as assert from 'node:assert/strict';
import { openTestDb } from '../db/connection.js';
import { createExperiment, insertMetric } from '../db/queries.js';
import { compareMetrics, parseMetricsOutput, isGateFixture, checkGateViolations } from '../metrics.js';
import type { MajlisConfig } from '../types.js';
import type Database from 'better-sqlite3';

const testConfig: MajlisConfig = {
  project: { name: 'test', description: 'test', objective: 'test' },
  metrics: {
    command: 'echo test',
    fixtures: {
      ubracket: { gate: true },
      sig1: { gate: false },
    },
    tracked: {
      free_edges: { direction: 'lower_is_better', target: 0 },
      volume_error: { direction: 'lower_is_better', target: 0.001 },
      face_count: { direction: 'higher_is_better' },
    },
  },
  build: { pre_measure: null, post_measure: null },
  cycle: {
    compression_interval: 5,
    circuit_breaker_threshold: 3,
    require_doubt_before_verify: true,
    require_challenge_before_verify: false,
    auto_baseline_on_new_experiment: false,
  },
  models: {},
};

let db: Database.Database;

beforeEach(() => {
  db = openTestDb();
});

describe('compareMetrics()', () => {
  it('detects regression when lower_is_better metric increases', () => {
    const exp = createExperiment(db, 'test', 'exp/001', 'Test', null, null);
    insertMetric(db, exp.id, 'before', 'ubracket', 'free_edges', 5);
    insertMetric(db, exp.id, 'after', 'ubracket', 'free_edges', 10);

    const comparisons = compareMetrics(db, exp.id, testConfig);
    const freeEdges = comparisons.find(c => c.metric === 'free_edges' && c.fixture === 'ubracket');
    assert.ok(freeEdges);
    assert.equal(freeEdges.regression, true);
    assert.equal(freeEdges.delta, 5);
  });

  it('no regression when lower_is_better metric decreases', () => {
    const exp = createExperiment(db, 'test', 'exp/001', 'Test', null, null);
    insertMetric(db, exp.id, 'before', 'ubracket', 'free_edges', 10);
    insertMetric(db, exp.id, 'after', 'ubracket', 'free_edges', 3);

    const comparisons = compareMetrics(db, exp.id, testConfig);
    const freeEdges = comparisons.find(c => c.metric === 'free_edges');
    assert.ok(freeEdges);
    assert.equal(freeEdges.regression, false);
    assert.equal(freeEdges.delta, -7);
  });

  it('detects regression when higher_is_better metric decreases', () => {
    const exp = createExperiment(db, 'test', 'exp/001', 'Test', null, null);
    insertMetric(db, exp.id, 'before', 'ubracket', 'face_count', 36);
    insertMetric(db, exp.id, 'after', 'ubracket', 'face_count', 30);

    const comparisons = compareMetrics(db, exp.id, testConfig);
    const faceCount = comparisons.find(c => c.metric === 'face_count');
    assert.ok(faceCount);
    assert.equal(faceCount.regression, true);
  });

  it('handles multiple fixtures', () => {
    const exp = createExperiment(db, 'test', 'exp/001', 'Test', null, null);
    insertMetric(db, exp.id, 'before', 'ubracket', 'free_edges', 5);
    insertMetric(db, exp.id, 'after', 'ubracket', 'free_edges', 0);
    insertMetric(db, exp.id, 'before', 'sig1', 'free_edges', 25);
    insertMetric(db, exp.id, 'after', 'sig1', 'free_edges', 30);

    const comparisons = compareMetrics(db, exp.id, testConfig);
    const ubracket = comparisons.find(c => c.fixture === 'ubracket' && c.metric === 'free_edges');
    const sig1 = comparisons.find(c => c.fixture === 'sig1' && c.metric === 'free_edges');
    assert.equal(ubracket?.regression, false);
    assert.equal(sig1?.regression, true);
  });

  it('returns empty array when no metrics', () => {
    const exp = createExperiment(db, 'test', 'exp/001', 'Test', null, null);
    const comparisons = compareMetrics(db, exp.id, testConfig);
    assert.equal(comparisons.length, 0);
  });

  it('skips metrics only present in one phase', () => {
    const exp = createExperiment(db, 'test', 'exp/001', 'Test', null, null);
    insertMetric(db, exp.id, 'before', 'ubracket', 'free_edges', 5);
    // No 'after' metric
    const comparisons = compareMetrics(db, exp.id, testConfig);
    assert.equal(comparisons.length, 0);
  });

  it('marks gate fixtures in comparisons', () => {
    const exp = createExperiment(db, 'test', 'exp/001', 'Test', null, null);
    insertMetric(db, exp.id, 'before', 'ubracket', 'free_edges', 0);
    insertMetric(db, exp.id, 'after', 'ubracket', 'free_edges', 3);
    insertMetric(db, exp.id, 'before', 'sig1', 'free_edges', 25);
    insertMetric(db, exp.id, 'after', 'sig1', 'free_edges', 20);

    const comparisons = compareMetrics(db, exp.id, testConfig);
    const ubracket = comparisons.find(c => c.fixture === 'ubracket' && c.metric === 'free_edges');
    const sig1 = comparisons.find(c => c.fixture === 'sig1' && c.metric === 'free_edges');
    assert.equal(ubracket?.gate, true);
    assert.equal(sig1?.gate, false);
  });

  it('detects gate violations', () => {
    const exp = createExperiment(db, 'test', 'exp/001', 'Test', null, null);
    insertMetric(db, exp.id, 'before', 'ubracket', 'free_edges', 0);
    insertMetric(db, exp.id, 'after', 'ubracket', 'free_edges', 5);  // regression on gate
    insertMetric(db, exp.id, 'before', 'sig1', 'free_edges', 25);
    insertMetric(db, exp.id, 'after', 'sig1', 'free_edges', 20);     // improvement on non-gate

    const comparisons = compareMetrics(db, exp.id, testConfig);
    const violations = checkGateViolations(comparisons);
    assert.equal(violations.length, 1);
    assert.equal(violations[0].fixture, 'ubracket');
    assert.equal(violations[0].regression, true);
    assert.equal(violations[0].gate, true);
  });
});

describe('isGateFixture()', () => {
  it('returns true for gate fixtures', () => {
    assert.equal(isGateFixture({ baseline: { gate: true }, target: {} }, 'baseline'), true);
  });

  it('returns false for non-gate fixtures', () => {
    assert.equal(isGateFixture({ baseline: { gate: true }, target: {} }, 'target'), false);
  });

  it('returns false for legacy array format', () => {
    assert.equal(isGateFixture(['baseline', 'target'], 'baseline'), false);
  });

  it('returns false for unknown fixtures', () => {
    assert.equal(isGateFixture({ baseline: { gate: true } }, 'unknown'), false);
  });
});

describe('parseMetricsOutput()', () => {
  it('parses standard fixture format', () => {
    const json = JSON.stringify({
      fixtures: {
        ubracket: { free_edges: 0, volume_error: 0.0003, face_count: 36 },
        sig1: { free_edges: 25, volume_error: 6.51, face_count: 39 },
      },
    });
    const result = parseMetricsOutput(json);
    assert.equal(result.length, 6);
    assert.ok(result.find(r => r.fixture === 'ubracket' && r.metric_name === 'free_edges'));
    assert.equal(
      result.find(r => r.fixture === 'ubracket' && r.metric_name === 'free_edges')?.metric_value,
      0,
    );
  });

  it('handles empty fixtures', () => {
    const json = JSON.stringify({ fixtures: {} });
    const result = parseMetricsOutput(json);
    assert.equal(result.length, 0);
  });

  it('skips non-numeric values', () => {
    const json = JSON.stringify({
      fixtures: {
        test: { numeric: 5, string_val: 'hello', boolean_val: true },
      },
    });
    const result = parseMetricsOutput(json);
    assert.equal(result.length, 1);
    assert.equal(result[0].metric_name, 'numeric');
  });
});
