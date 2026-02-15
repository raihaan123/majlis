import * as fs from 'node:fs';
import * as path from 'node:path';
import { getDb, findProjectRoot } from '../db/connection.js';
import {
  listActiveExperiments,
  getActiveSession,
  getSessionsSinceCompression,
  getAllCircuitBreakerStates,
  listAllDecisions,
} from '../db/queries.js';
import type { MajlisConfig } from '../types.js';
import * as fmt from '../output/format.js';

export async function status(isJson: boolean): Promise<void> {
  const root = findProjectRoot();
  if (!root) throw new Error('Not in a Majlis project. Run `majlis init` first.');

  const db = getDb(root);
  const config = loadConfig(root);

  const experiments = listActiveExperiments(db);
  const activeSession = getActiveSession(db);
  const sessionsSinceCompression = getSessionsSinceCompression(db);
  const circuitBreakers = getAllCircuitBreakerStates(db, config.cycle.circuit_breaker_threshold);
  const judgmentDecisions = listAllDecisions(db, 'judgment');

  if (isJson) {
    const data = {
      summary: buildSummary(experiments.length, activeSession, sessionsSinceCompression, config),
      experiments: experiments.map(e => ({
        id: e.id,
        slug: e.slug,
        status: e.status,
        sub_type: e.sub_type,
        hypothesis: e.hypothesis,
      })),
      active_session: activeSession ? {
        id: activeSession.id,
        intent: activeSession.intent,
        started_at: activeSession.started_at,
      } : null,
      sessions_since_compression: sessionsSinceCompression,
      compression_due: sessionsSinceCompression >= config.cycle.compression_interval,
      circuit_breakers: circuitBreakers,
      judgment_decisions_count: judgmentDecisions.length,
    };
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  fmt.header('Project Status');

  // Active experiments
  if (experiments.length === 0) {
    console.log('  No active experiments.\n');
  } else {
    const rows = experiments.map(e => [
      String(e.id),
      e.slug,
      fmt.statusColor(e.status),
      e.sub_type ?? '—',
    ]);
    console.log(fmt.table(['ID', 'Slug', 'Status', 'Sub-Type'], rows));
    console.log();
  }

  // Active session
  if (activeSession) {
    console.log(`  ${fmt.bold('Active session:')} ${activeSession.intent}`);
    console.log(`  Started: ${activeSession.started_at}\n`);
  } else {
    console.log(`  ${fmt.dim('No active session.')}\n`);
  }

  // Compression warning
  if (sessionsSinceCompression >= config.cycle.compression_interval) {
    fmt.warn(
      `${sessionsSinceCompression} sessions since last compression ` +
      `(threshold: ${config.cycle.compression_interval}). Run \`majlis compress\`.`
    );
  } else {
    console.log(`  Sessions since compression: ${sessionsSinceCompression}/${config.cycle.compression_interval}`);
  }

  // Circuit breakers
  if (circuitBreakers.length > 0) {
    console.log();
    const cbRows = circuitBreakers.map(cb => [
      cb.sub_type,
      String(cb.failure_count),
      cb.tripped ? fmt.red('TRIPPED') : fmt.green('OK'),
    ]);
    console.log(fmt.table(['Sub-Type', 'Failures', 'Status'], cbRows));
  }

  // Judgment decisions
  if (judgmentDecisions.length > 0) {
    console.log(`\n  ${fmt.yellow(`${judgmentDecisions.length} judgment-level decisions`)} (provisional targets for doubt)`);
  }
}

function buildSummary(
  expCount: number,
  activeSession: { intent: string } | null,
  sessionsSinceCompression: number,
  config: MajlisConfig,
): string {
  const parts: string[] = [];
  parts.push(`${expCount} active experiment(s)`);
  if (activeSession) parts.push(`Session: ${activeSession.intent}`);
  if (sessionsSinceCompression >= config.cycle.compression_interval) {
    parts.push(`Compression due (${sessionsSinceCompression} sessions)`);
  }
  return parts.join('. ');
}

function loadConfig(projectRoot: string): MajlisConfig {
  const configPath = path.join(projectRoot, '.majlis', 'config.json');
  if (!fs.existsSync(configPath)) {
    throw new Error('Missing .majlis/config.json. Run `majlis init` first.');
  }
  return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
}
