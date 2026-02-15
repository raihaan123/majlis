import type Database from 'better-sqlite3';
import type { MetricComparison, MetricSnapshot, MajlisConfig } from './types.js';
import { getMetricsByExperimentAndPhase } from './db/queries.js';

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
        const direction = config.metrics.tracked[metric]?.direction ?? 'lower_is_better';
        const regression = isRegression(b.metric_value, a.metric_value, direction);

        comparisons.push({
          fixture,
          metric,
          before: b.metric_value,
          after: a.metric_value,
          delta: a.metric_value - b.metric_value,
          regression,
        });
      }
    }
  }

  return comparisons;
}

function isRegression(before: number, after: number, direction: string): boolean {
  switch (direction) {
    case 'lower_is_better':
      return after > before;
    case 'higher_is_better':
      return after < before;
    case 'closer_to_gt':
      // Without ground truth, we can't determine regression — assume no regression
      return false;
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
