import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import type Database from 'better-sqlite3';
import type { MajlisConfig } from '../types.js';
import type { ProjectProfile } from './surface.js';
import {
  getLastCompression,
  listAllExperiments,
  listActiveExperiments,
} from '../db/queries.js';
import * as fmt from '../output/format.js';

// ─── Types ──────────────────────────────────────────────────────────────────────

export interface ConfigDrift {
  testCommandChanged: boolean;
  buildCommandChanged: boolean;
  items: string[];
}

export interface StalenessReport {
  lastActivityTimestamp: string | null;
  lastActivitySource: 'compression' | 'experiment' | 'session' | 'never';
  daysSinceActivity: number;
  commitsSinceActivity: number;
  filesChanged: number;
  gitDiffStat: string;
  configDrift: ConfigDrift;
  synthesisSize: number;
  unresolvedDoubts: number;
  activeExperiments: number;
  totalExperiments: number;
  metricsWorking: boolean;
  metricsError: string | null;
  needsToolsmith: boolean;
}

// ─── Last Activity ──────────────────────────────────────────────────────────────

interface ActivityInfo {
  timestamp: string | null;
  source: 'compression' | 'experiment' | 'session' | 'never';
}

export function getLastActivityTimestamp(db: Database.Database): ActivityInfo {
  let latest: string | null = null;
  let source: ActivityInfo['source'] = 'never';

  // Check compressions
  const lastComp = getLastCompression(db);
  if (lastComp?.created_at) {
    latest = lastComp.created_at;
    source = 'compression';
  }

  // Check experiments
  const experiments = listAllExperiments(db);
  for (const exp of experiments) {
    const ts = exp.updated_at ?? exp.created_at;
    if (ts && (!latest || ts > latest)) {
      latest = ts;
      source = 'experiment';
    }
  }

  // Check sessions
  const lastSession = db.prepare(`
    SELECT COALESCE(ended_at, started_at) as ts FROM sessions
    ORDER BY COALESCE(ended_at, started_at) DESC LIMIT 1
  `).get() as { ts: string } | undefined;

  if (lastSession?.ts && (!latest || lastSession.ts > latest)) {
    latest = lastSession.ts;
    source = 'session';
  }

  return { timestamp: latest, source };
}

// ─── Git Delta ──────────────────────────────────────────────────────────────────

function getCommitsSince(root: string, timestamp: string): number {
  try {
    const output = execSync(
      `git log --since="${timestamp}" --oneline -- . ":!.majlis/" ":!docs/"`,
      { cwd: root, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
    ).trim();
    if (!output) return 0;
    return output.split('\n').length;
  } catch {
    return 0;
  }
}

function getGitDiffStat(root: string, timestamp: string): { stat: string; filesChanged: number } {
  try {
    // Find the commit closest to the timestamp
    const baseRef = execSync(
      `git rev-list -1 --before="${timestamp}" HEAD`,
      { cwd: root, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
    ).trim();

    if (!baseRef) return { stat: '', filesChanged: 0 };

    const stat = execSync(
      `git diff --stat ${baseRef} -- . ":!.majlis/" ":!docs/"`,
      { cwd: root, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
    ).trim();

    // Count files changed from the stat output
    const lines = stat.split('\n');
    const filesChanged = Math.max(0, lines.length - 1); // last line is summary

    // Truncate to 5000 chars
    const truncated = stat.length > 5000 ? stat.slice(0, 5000) + '\n  ... (truncated)' : stat;

    return { stat: truncated, filesChanged };
  } catch {
    return { stat: '', filesChanged: 0 };
  }
}

// ─── Config Drift ───────────────────────────────────────────────────────────────

function detectConfigDrift(config: MajlisConfig, profile: ProjectProfile): ConfigDrift {
  const items: string[] = [];
  let testCommandChanged = false;
  let buildCommandChanged = false;

  // Compare test commands — only flag drift if both exist and differ
  const configTest = config.metrics?.command ?? '';
  const profileTest = profile.testCommand;
  if (profileTest && configTest && !configTest.includes(profileTest)) {
    // Also check if the config test command is just the metrics wrapper
    if (!configTest.includes('metrics.sh')) {
      testCommandChanged = true;
      items.push(`Test command changed: ${configTest} → ${profileTest}`);
    }
  }

  // Compare build commands
  const configBuild = config.build?.pre_measure ?? '';
  const profileBuild = profile.buildCommand;
  if (profileBuild && configBuild && configBuild !== profileBuild) {
    buildCommandChanged = true;
    items.push(`Build command changed: ${configBuild} → ${profileBuild}`);
  }

  return { testCommandChanged, buildCommandChanged, items };
}

// ─── Metrics Check ──────────────────────────────────────────────────────────────

function checkMetrics(root: string, config: MajlisConfig): { working: boolean; error: string | null } {
  const command = config.metrics?.command;
  if (!command) return { working: false, error: 'No metrics command configured' };

  try {
    // If the command is a script path, check it exists
    const scriptPath = path.join(root, command);
    if (command.includes('/') && !fs.existsSync(scriptPath)) {
      return { working: false, error: `Script not found: ${command}` };
    }

    const output = execSync(command, {
      cwd: root,
      encoding: 'utf-8',
      timeout: 60_000,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();

    JSON.parse(output); // Validate JSON
    return { working: true, error: null };
  } catch (err) {
    const msg = err instanceof Error ? err.message.split('\n')[0] : String(err);
    return { working: false, error: msg };
  }
}

// ─── Main Assessment ────────────────────────────────────────────────────────────

export function assessStaleness(
  db: Database.Database,
  root: string,
  profile: ProjectProfile,
  config: MajlisConfig,
): StalenessReport {
  const activity = getLastActivityTimestamp(db);

  // Days since activity
  let daysSinceActivity = 0;
  let commitsSinceActivity = 0;
  let filesChanged = 0;
  let gitDiffStat = '';

  if (activity.timestamp) {
    const activityDate = new Date(activity.timestamp);
    daysSinceActivity = Math.floor((Date.now() - activityDate.getTime()) / (1000 * 60 * 60 * 24));
    commitsSinceActivity = getCommitsSince(root, activity.timestamp);
    const diffResult = getGitDiffStat(root, activity.timestamp);
    gitDiffStat = diffResult.stat;
    filesChanged = diffResult.filesChanged;
  }

  // Config drift
  const configDrift = detectConfigDrift(config, profile);

  // Synthesis size
  const synthesisPath = path.join(root, 'docs', 'synthesis', 'current.md');
  let synthesisSize = 0;
  try {
    synthesisSize = fs.statSync(synthesisPath).size;
  } catch { /* doesn't exist */ }

  // Unresolved doubts
  const unresolvedDoubts = (db.prepare(`
    SELECT COUNT(*) as count FROM doubts WHERE resolution IS NULL
  `).get() as { count: number }).count;

  // Experiments
  const activeExperiments = listActiveExperiments(db).length;
  const totalExperiments = listAllExperiments(db).length;

  // Metrics check
  const metrics = checkMetrics(root, config);

  // Determine if toolsmith is needed
  const needsToolsmith =
    !metrics.working ||
    configDrift.testCommandChanged ||
    configDrift.buildCommandChanged ||
    !config.metrics?.command;

  return {
    lastActivityTimestamp: activity.timestamp,
    lastActivitySource: activity.source,
    daysSinceActivity,
    commitsSinceActivity,
    filesChanged,
    gitDiffStat,
    configDrift,
    synthesisSize,
    unresolvedDoubts,
    activeExperiments,
    totalExperiments,
    metricsWorking: metrics.working,
    metricsError: metrics.error,
    needsToolsmith,
  };
}

// ─── Pretty Print ───────────────────────────────────────────────────────────────

export function printStalenessReport(report: StalenessReport): void {
  fmt.header('Staleness Report');

  if (report.lastActivityTimestamp) {
    const sourceLabel = report.lastActivitySource;
    fmt.info(`  Last activity: ${report.daysSinceActivity} days ago (${sourceLabel})`);
  } else {
    fmt.info('  Last activity: never');
  }

  fmt.info(`  Commits since: ${report.commitsSinceActivity}`);
  fmt.info(`  Files changed: ${report.filesChanged}`);
  fmt.info(`  Unresolved doubts: ${report.unresolvedDoubts}`);
  fmt.info(`  Experiments: ${report.totalExperiments} total, ${report.activeExperiments} active`);

  if (report.metricsWorking) {
    fmt.success('  Metrics working: YES');
  } else {
    fmt.warn(`  Metrics working: NO — ${report.metricsError ?? 'unknown error'}`);
  }

  if (report.configDrift.items.length > 0) {
    fmt.info('');
    fmt.info('  Config drift:');
    for (const item of report.configDrift.items) {
      fmt.info(`    - ${item}`);
    }
  }

  fmt.info('');
  if (report.commitsSinceActivity > 0 || report.configDrift.items.length > 0 || !report.metricsWorking) {
    fmt.info('  Recommendation: Run `majlis resync` to update synthesis and metrics.');
  } else {
    fmt.success('  Already up to date.');
  }
}
