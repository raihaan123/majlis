import * as fs from 'node:fs';
import * as path from 'node:path';
import { getDb, findProjectRoot } from '../db/connection.js';
import { listAllDeadEnds, listAllExperiments, getAllCircuitBreakerStates } from '../db/queries.js';
import { spawnAgent } from '../agents/spawn.js';
import type { MajlisConfig } from '../types.js';
import * as fmt from '../output/format.js';

/**
 * Maqasid Check — Purpose Audit.
 * Triggered by circuit breaker (3+ failures on same sub-type) or manually.
 * Asks: is the classification serving the actual objective?
 */
export async function audit(args: string[]): Promise<void> {
  const root = findProjectRoot();
  if (!root) throw new Error('Not in a Majlis project. Run `majlis init` first.');

  const db = getDb(root);
  const objective = args.filter(a => !a.startsWith('--')).join(' ');

  // Gather context for the audit
  const config = loadConfig(root);
  const experiments = listAllExperiments(db);
  const deadEnds = listAllDeadEnds(db);
  const circuitBreakers = getAllCircuitBreakerStates(db, config.cycle.circuit_breaker_threshold);

  const classificationDir = path.join(root, 'docs', 'classification');
  let classification = '';
  if (fs.existsSync(classificationDir)) {
    const files = fs.readdirSync(classificationDir).filter(f => f.endsWith('.md') && !f.startsWith('_'));
    for (const f of files) {
      classification += fs.readFileSync(path.join(classificationDir, f), 'utf-8') + '\n\n';
    }
  }

  const synthesisPath = path.join(root, 'docs', 'synthesis', 'current.md');
  const synthesis = fs.existsSync(synthesisPath) ? fs.readFileSync(synthesisPath, 'utf-8') : '';

  fmt.header('Maqasid Check — Purpose Audit');

  const trippedBreakers = circuitBreakers.filter(cb => cb.tripped);
  if (trippedBreakers.length > 0) {
    fmt.warn(`Circuit breaker(s) tripped: ${trippedBreakers.map(cb => cb.sub_type).join(', ')}`);
  }

  const auditPrompt =
    `You are performing a Maqasid Check (purpose audit).\n\n` +
    `ORIGINAL OBJECTIVE: ${objective || config.project?.objective || 'Not specified'}\n\n` +
    `CURRENT CLASSIFICATION:\n${classification}\n\n` +
    `PROJECT SYNTHESIS:\n${synthesis}\n\n` +
    `DEAD-ENDS (${deadEnds.length} total):\n${deadEnds.map(d =>
      `- ${d.approach}: ${d.structural_constraint}`
    ).join('\n')}\n\n` +
    `EXPERIMENT HISTORY (${experiments.length} total):\n${experiments.map(e =>
      `- #${e.id} ${e.slug}: ${e.status} (sub-type: ${e.sub_type ?? 'none'})`
    ).join('\n')}\n\n` +
    `TRIPPED CIRCUIT BREAKERS:\n${trippedBreakers.map(cb =>
      `- ${cb.sub_type}: ${cb.failure_count} failures`
    ).join('\n') || 'None'}\n\n` +
    `Answer these questions:\n` +
    `1. What is the actual objective? Trace back from current experiments to the root goal.\n` +
    `2. Is the current classification serving that objective? Or has the taxonomy become self-referential?\n` +
    `3. What would we do differently if we started from scratch with what we now know?\n` +
    `4. Is there a simpler formulation? If the classification has grown complex, something may be wrong.\n\n` +
    `Output: either "classification confirmed — continue" or "re-classify from X" with a specific proposal.`;

  const result = await spawnAgent('builder', {
    synthesis,
    taskPrompt: auditPrompt,
  }, root);

  fmt.success('Purpose audit complete. Review the output above.');
}

function loadConfig(projectRoot: string): MajlisConfig {
  const configPath = path.join(projectRoot, '.majlis', 'config.json');
  if (!fs.existsSync(configPath)) {
    return { project: { name: '', description: '', objective: '' }, cycle: { circuit_breaker_threshold: 3 } } as MajlisConfig;
  }
  return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
}
