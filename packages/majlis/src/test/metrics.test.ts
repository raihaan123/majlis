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
      benchmark_a: { gate: true },
      benchmark_b: { gate: false },
    },
    tracked: {
      error_count: { direction: 'lower_is_better', target: 0 },
      latency_ms: { direction: 'lower_is_better', target: 0.001 },
      throughput: { direction: 'higher_is_better' },
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
    insertMetric(db, exp.id, 'before', 'benchmark_a', 'error_count', 5);
    insertMetric(db, exp.id, 'after', 'benchmark_a', 'error_count', 10);

    const comparisons = compareMetrics(db, exp.id, testConfig);
    const errors = comparisons.find(c => c.metric === 'error_count' && c.fixture === 'benchmark_a');
    assert.ok(errors);
    assert.equal(errors.regression, true);
    assert.equal(errors.delta, 5);
  });

  it('no regression when lower_is_better metric decreases', () => {
    const exp = createExperiment(db, 'test', 'exp/001', 'Test', null, null);
    insertMetric(db, exp.id, 'before', 'benchmark_a', 'error_count', 10);
    insertMetric(db, exp.id, 'after', 'benchmark_a', 'error_count', 3);

    const comparisons = compareMetrics(db, exp.id, testConfig);
    const errors = comparisons.find(c => c.metric === 'error_count');
    assert.ok(errors);
    assert.equal(errors.regression, false);
    assert.equal(errors.delta, -7);
  });

  it('detects regression when higher_is_better metric decreases', () => {
    const exp = createExperiment(db, 'test', 'exp/001', 'Test', null, null);
    insertMetric(db, exp.id, 'before', 'benchmark_a', 'throughput', 36);
    insertMetric(db, exp.id, 'after', 'benchmark_a', 'throughput', 30);

    const comparisons = compareMetrics(db, exp.id, testConfig);
    const tp = comparisons.find(c => c.metric === 'throughput');
    assert.ok(tp);
    assert.equal(tp.regression, true);
  });

  it('handles multiple fixtures', () => {
    const exp = createExperiment(db, 'test', 'exp/001', 'Test', null, null);
    insertMetric(db, exp.id, 'before', 'benchmark_a', 'error_count', 5);
    insertMetric(db, exp.id, 'after', 'benchmark_a', 'error_count', 0);
    insertMetric(db, exp.id, 'before', 'benchmark_b', 'error_count', 25);
    insertMetric(db, exp.id, 'after', 'benchmark_b', 'error_count', 30);

    const comparisons = compareMetrics(db, exp.id, testConfig);
    const bmA = comparisons.find(c => c.fixture === 'benchmark_a' && c.metric === 'error_count');
    const bmB = comparisons.find(c => c.fixture === 'benchmark_b' && c.metric === 'error_count');
    assert.equal(bmA?.regression, false);
    assert.equal(bmB?.regression, true);
  });

  it('returns empty array when no metrics', () => {
    const exp = createExperiment(db, 'test', 'exp/001', 'Test', null, null);
    const comparisons = compareMetrics(db, exp.id, testConfig);
    assert.equal(comparisons.length, 0);
  });

  it('skips metrics only present in one phase', () => {
    const exp = createExperiment(db, 'test', 'exp/001', 'Test', null, null);
    insertMetric(db, exp.id, 'before', 'benchmark_a', 'error_count', 5);
    // No 'after' metric
    const comparisons = compareMetrics(db, exp.id, testConfig);
    assert.equal(comparisons.length, 0);
  });

  it('marks gate fixtures in comparisons', () => {
    const exp = createExperiment(db, 'test', 'exp/001', 'Test', null, null);
    insertMetric(db, exp.id, 'before', 'benchmark_a', 'error_count', 0);
    insertMetric(db, exp.id, 'after', 'benchmark_a', 'error_count', 3);
    insertMetric(db, exp.id, 'before', 'benchmark_b', 'error_count', 25);
    insertMetric(db, exp.id, 'after', 'benchmark_b', 'error_count', 20);

    const comparisons = compareMetrics(db, exp.id, testConfig);
    const bmA = comparisons.find(c => c.fixture === 'benchmark_a' && c.metric === 'error_count');
    const bmB = comparisons.find(c => c.fixture === 'benchmark_b' && c.metric === 'error_count');
    assert.equal(bmA?.gate, true);
    assert.equal(bmB?.gate, false);
  });

  it('detects gate violations', () => {
    const exp = createExperiment(db, 'test', 'exp/001', 'Test', null, null);
    insertMetric(db, exp.id, 'before', 'benchmark_a', 'error_count', 0);
    insertMetric(db, exp.id, 'after', 'benchmark_a', 'error_count', 5);  // regression on gate
    insertMetric(db, exp.id, 'before', 'benchmark_b', 'error_count', 25);
    insertMetric(db, exp.id, 'after', 'benchmark_b', 'error_count', 20);     // improvement on non-gate

    const comparisons = compareMetrics(db, exp.id, testConfig);
    const violations = checkGateViolations(comparisons);
    assert.equal(violations.length, 1);
    assert.equal(violations[0].fixture, 'benchmark_a');
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
        benchmark_a: { error_count: 0, latency_ms: 0.0003, throughput: 36 },
        benchmark_b: { error_count: 25, latency_ms: 6.51, throughput: 39 },
      },
    });
    const result = parseMetricsOutput(json);
    assert.equal(result.length, 6);
    assert.ok(result.find(r => r.fixture === 'benchmark_a' && r.metric_name === 'error_count'));
    assert.equal(
      result.find(r => r.fixture === 'benchmark_a' && r.metric_name === 'error_count')?.metric_value,
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
