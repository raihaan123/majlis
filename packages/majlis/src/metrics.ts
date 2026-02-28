import type Database from 'better-sqlite3';
import type { MetricComparison, MetricSnapshot, MajlisConfig } from './types.js';
import { getMetricsByExperimentAndPhase } from './db/queries.js';

/**
 * Resolve whether a fixture is a regression gate.
 * Handles both legacy format (string[]) and new format (Record<string, FixtureConfig>).
 */
export function isGateFixture(fixtures: MajlisConfig['metrics']['fixtures'], fixtureName: string): boolean {
  if (Array.isArray(fixtures)) return false;  // Legacy format — no gates
  return fixtures[fixtureName]?.gate === true;
}

/**
 * Compare before/after metrics for an experiment.
 * Deterministic — no LLM needed. PRD v2 §4.7.
 */
export function compareMetrics(
  db: Database.Database,
  experimentId: number,
  config: MajlisConfig,
): MetricComparison[] {
  const before = getMetricsByExperimentAndPhase(db, experimentId, 'before');
  const after = getMetricsByExperimentAndPhase(db, experimentId, 'after');

  const fixtures = new Set([...before, ...after].map(m => m.fixture));
  const trackedMetrics = Object.keys(config.metrics.tracked);
  const comparisons: MetricComparison[] = [];

  for (const fixture of fixtures) {
    for (const metric of trackedMetrics) {
      const b = before.find(m => m.fixture === fixture && m.metric_name === metric);
      const a = after.find(m => m.fixture === fixture && m.metric_name === metric);

      if (b && a) {
        const tracked = config.metrics.tracked[metric];
        const direction = tracked?.direction ?? 'lower_is_better';
        const target = tracked?.target;
        const regression = isRegression(b.metric_value, a.metric_value, direction, target);

        comparisons.push({
          fixture,
          metric,
          before: b.metric_value,
          after: a.metric_value,
          delta: a.metric_value - b.metric_value,
          regression,
          gate: isGateFixture(config.metrics.fixtures, fixture),
        });
      }
    }
  }

  return comparisons;
}

/**
 * Check for gate violations — regressions on gate fixtures.
 * Returns the list of violated gate comparisons.
 * A single gate violation blocks merge (Tradition 3: jarh wa ta'dil).
 */
export function checkGateViolations(comparisons: MetricComparison[]): MetricComparison[] {
  return comparisons.filter(c => c.gate && c.regression);
}

function isRegression(before: number, after: number, direction: string, target?: number): boolean {
  switch (direction) {
    case 'lower_is_better':
      return after > before;
    case 'higher_is_better':
      return after < before;
    case 'closer_to_gt':
      if (target === undefined) return false; // No ground truth configured
      return Math.abs(after - target) > Math.abs(before - target);
    default:
      return false;
  }
}

/**
 * Parse metrics JSON output from the project's benchmark command.
 * Expected format: { fixtures: { name: { metric: value, ... }, ... } }
 */
export function parseMetricsOutput(
  jsonStr: string,
): Array<{ fixture: string; metric_name: string; metric_value: number }> {
  const data = JSON.parse(jsonStr);
  const results: Array<{ fixture: string; metric_name: string; metric_value: number }> = [];

  if (data.fixtures && typeof data.fixtures === 'object') {
    for (const [fixture, metrics] of Object.entries(data.fixtures)) {
      for (const [metricName, metricValue] of Object.entries(metrics as Record<string, number>)) {
        if (typeof metricValue === 'number') {
          results.push({ fixture, metric_name: metricName, metric_value: metricValue });
        }
      }
    }
  }

  return results;
}
