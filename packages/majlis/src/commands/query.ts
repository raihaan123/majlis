import * as fs from 'node:fs';
import * as path from 'node:path';
import { getDb, findProjectRoot } from '../db/connection.js';
import {
  listAllDecisions,
  listAllDeadEnds,
  listDeadEndsBySubType,
  searchDeadEnds,
  getMetricHistoryByFixture,
  getAllCircuitBreakerStates,
  listActiveExperiments,
} from '../db/queries.js';
import { loadConfig, getFlagValue } from '../config.js';
import * as fmt from '../output/format.js';

export async function query(
  command: string,
  args: string[],
  isJson: boolean,
): Promise<void> {
  const root = findProjectRoot();
  if (!root) throw new Error('Not in a Majlis project. Run `majlis init` first.');

  const db = getDb(root);

  switch (command) {
    case 'decisions':
      return queryDecisions(db, args, isJson);
    case 'dead-ends':
      return queryDeadEnds(db, args, isJson);
    case 'fragility':
      return queryFragility(root, isJson);
    case 'history':
      return queryHistory(db, args, isJson);
    case 'circuit-breakers':
      return queryCircuitBreakers(db, root, isJson);
    case 'check-commit':
      return checkCommit(db);
  }
}

function queryDecisions(db: ReturnType<typeof getDb>, args: string[], isJson: boolean): void {
  const level = getFlagValue(args, '--level');
  const expIdStr = getFlagValue(args, '--experiment');
  const experimentId = expIdStr !== undefined ? Number(expIdStr) : undefined;

  const decisions = listAllDecisions(db, level, experimentId);

  if (isJson) {
    console.log(JSON.stringify(decisions, null, 2));
    return;
  }

  if (decisions.length === 0) {
    fmt.info('No decisions found.');
    return;
  }

  fmt.header('Decisions');
  const rows = decisions.map(d => [
    String(d.id),
    String(d.experiment_id),
    fmt.evidenceColor(d.evidence_level),
    d.description.slice(0, 60) + (d.description.length > 60 ? '...' : ''),
    d.status,
  ]);
  console.log(fmt.table(['ID', 'Exp', 'Level', 'Description', 'Status'], rows));
}

function queryDeadEnds(db: ReturnType<typeof getDb>, args: string[], isJson: boolean): void {
  const subType = getFlagValue(args, '--sub-type');
  const searchTerm = getFlagValue(args, '--search');

  let deadEnds;
  if (subType) {
    deadEnds = listDeadEndsBySubType(db, subType);
  } else if (searchTerm) {
    deadEnds = searchDeadEnds(db, searchTerm);
  } else {
    deadEnds = listAllDeadEnds(db);
  }

  if (isJson) {
    console.log(JSON.stringify(deadEnds, null, 2));
    return;
  }

  if (deadEnds.length === 0) {
    fmt.info('No dead-ends recorded.');
    return;
  }

  fmt.header('Dead-End Registry');
  const rows = deadEnds.map(d => [
    String(d.id),
    d.sub_type ?? '—',
    d.approach.slice(0, 40) + (d.approach.length > 40 ? '...' : ''),
    d.structural_constraint.slice(0, 40) + (d.structural_constraint.length > 40 ? '...' : ''),
  ]);
  console.log(fmt.table(['ID', 'Sub-Type', 'Approach', 'Constraint'], rows));
}

function queryFragility(root: string, isJson: boolean): void {
  const fragPath = path.join(root, 'docs', 'synthesis', 'fragility.md');

  if (!fs.existsSync(fragPath)) {
    fmt.info('No fragility map found.');
    return;
  }

  const content = fs.readFileSync(fragPath, 'utf-8');

  if (isJson) {
    console.log(JSON.stringify({ content }, null, 2));
    return;
  }

  fmt.header('Fragility Map');
  console.log(content);
}

function queryHistory(db: ReturnType<typeof getDb>, args: string[], isJson: boolean): void {
  const fixture = args.filter(a => !a.startsWith('--'))[0];
  if (!fixture) {
    throw new Error('Usage: majlis history <fixture>');
  }

  const history = getMetricHistoryByFixture(db, fixture);

  if (isJson) {
    console.log(JSON.stringify(history, null, 2));
    return;
  }

  if (history.length === 0) {
    fmt.info(`No metric history for fixture: ${fixture}`);
    return;
  }

  fmt.header(`Metric History — ${fixture}`);
  const rows = history.map((h: any) => [
    String(h.experiment_id),
    h.experiment_slug ?? '—',
    h.phase,
    h.metric_name,
    String(h.metric_value),
    h.captured_at,
  ]);
  console.log(fmt.table(['Exp', 'Slug', 'Phase', 'Metric', 'Value', 'Captured'], rows));
}

function queryCircuitBreakers(db: ReturnType<typeof getDb>, root: string, isJson: boolean): void {
  const config = loadConfig(root);
  const states = getAllCircuitBreakerStates(db, config.cycle.circuit_breaker_threshold);

  if (isJson) {
    console.log(JSON.stringify(states, null, 2));
    return;
  }

  if (states.length === 0) {
    fmt.info('No circuit breaker data.');
    return;
  }

  fmt.header('Circuit Breakers');
  const rows = states.map(s => [
    s.sub_type,
    String(s.failure_count),
    String(config.cycle.circuit_breaker_threshold),
    s.tripped ? fmt.red('TRIPPED') : fmt.green('OK'),
  ]);
  console.log(fmt.table(['Sub-Type', 'Failures', 'Threshold', 'Status'], rows));
}

function checkCommit(db: ReturnType<typeof getDb>): void {
  // Read hook input from stdin to check if this is actually a git commit
  let stdinData = '';
  try {
    stdinData = fs.readFileSync(0, 'utf-8');
  } catch { /* no stdin available */ }

  // Only gate on actual git commit commands
  if (stdinData) {
    try {
      const hookInput = JSON.parse(stdinData);
      const command = hookInput?.tool_input?.command ?? '';
      if (!command.includes('git commit')) {
        return; // Not a commit — allow it
      }
    } catch { /* not JSON, fall through to check */ }
  }

  const active = listActiveExperiments(db);
  const unverified = active.filter(e =>
    !['merged', 'dead_end', 'verified', 'resolved', 'compressed'].includes(e.status)
  );

  if (unverified.length > 0) {
    console.error(`[majlis] ${unverified.length} unverified experiment(s):`);
    for (const e of unverified) {
      console.error(`  - ${e.slug} (${e.status})`);
    }
    process.exit(1);
  }
}

