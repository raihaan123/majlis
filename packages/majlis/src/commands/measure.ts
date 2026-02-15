import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import { getDb, findProjectRoot } from '../db/connection.js';
import {
  getLatestExperiment,
  getExperimentById,
  insertMetric,
} from '../db/queries.js';
import { compareMetrics, parseMetricsOutput } from '../metrics.js';
import type { MajlisConfig } from '../types.js';
import * as fmt from '../output/format.js';

export async function baseline(args: string[]): Promise<void> {
  await captureMetrics('before', args);
}

export async function measure(args: string[]): Promise<void> {
  await captureMetrics('after', args);
}

async function captureMetrics(phase: string, args: string[]): Promise<void> {
  const root = findProjectRoot();
  if (!root) throw new Error('Not in a Majlis project. Run `majlis init` first.');

  const db = getDb(root);
  const config = loadConfig(root);

  // Get experiment
  const expIdIdx = args.indexOf('--experiment');
  let exp;
  if (expIdIdx >= 0) {
    exp = getExperimentById(db, Number(args[expIdIdx + 1]));
  } else {
    exp = getLatestExperiment(db);
  }
  if (!exp) throw new Error('No active experiment. Run `majlis new "hypothesis"` first.');

  // Run pre-measure build command if configured
  if (config.build.pre_measure) {
    fmt.info(`Running pre-measure: ${config.build.pre_measure}`);
    try {
      execSync(config.build.pre_measure, { cwd: root, encoding: 'utf-8', stdio: 'inherit' });
    } catch {
      fmt.warn('Pre-measure command failed — continuing anyway.');
    }
  }

  // Run metrics command
  if (!config.metrics.command) {
    throw new Error('No metrics.command configured in .majlis/config.json');
  }

  fmt.info(`Running metrics: ${config.metrics.command}`);
  let metricsOutput: string;
  try {
    metricsOutput = execSync(config.metrics.command, {
      cwd: root,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (err) {
    throw new Error(`Metrics command failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Parse and store
  const parsed = parseMetricsOutput(metricsOutput);
  if (parsed.length === 0) {
    fmt.warn('Metrics command returned no data.');
    return;
  }

  for (const m of parsed) {
    insertMetric(db, exp.id, phase, m.fixture, m.metric_name, m.metric_value);
  }

  fmt.success(`Captured ${parsed.length} metric(s) for ${exp.slug} (phase: ${phase})`);

  // Run post-measure if configured
  if (config.build.post_measure) {
    try {
      execSync(config.build.post_measure, { cwd: root, encoding: 'utf-8', stdio: 'inherit' });
    } catch {
      fmt.warn('Post-measure command failed.');
    }
  }
}

export async function compare(args: string[], isJson: boolean): Promise<void> {
  const root = findProjectRoot();
  if (!root) throw new Error('Not in a Majlis project. Run `majlis init` first.');

  const db = getDb(root);
  const config = loadConfig(root);

  // Get experiment
  const expIdIdx = args.indexOf('--experiment');
  let exp;
  if (expIdIdx >= 0) {
    exp = getExperimentById(db, Number(args[expIdIdx + 1]));
  } else {
    exp = getLatestExperiment(db);
  }
  if (!exp) throw new Error('No active experiment.');

  const comparisons = compareMetrics(db, exp.id, config);

  if (comparisons.length === 0) {
    fmt.warn(`No before/after metrics to compare for ${exp.slug}. Run baseline and measure first.`);
    return;
  }

  if (isJson) {
    console.log(JSON.stringify({ experiment: exp.slug, comparisons }, null, 2));
    return;
  }

  fmt.header(`Metric Comparison — ${exp.slug}`);

  const regressions = comparisons.filter(c => c.regression);

  const rows = comparisons.map(c => [
    c.fixture,
    c.metric,
    String(c.before),
    String(c.after),
    formatDelta(c.delta),
    c.regression ? fmt.red('REGRESSION') : fmt.green('OK'),
  ]);

  console.log(fmt.table(['Fixture', 'Metric', 'Before', 'After', 'Delta', 'Status'], rows));

  if (regressions.length > 0) {
    console.log();
    fmt.warn(`${regressions.length} regression(s) detected!`);
  } else {
    console.log();
    fmt.success('No regressions detected.');
  }
}

function formatDelta(delta: number): string {
  const prefix = delta > 0 ? '+' : '';
  return `${prefix}${delta.toFixed(4)}`;
}

function loadConfig(projectRoot: string): MajlisConfig {
  const configPath = path.join(projectRoot, '.majlis', 'config.json');
  if (!fs.existsSync(configPath)) {
    throw new Error('Missing .majlis/config.json. Run `majlis init` first.');
  }
  return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
}
