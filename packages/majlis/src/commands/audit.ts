import * as fs from 'node:fs';
import * as path from 'node:path';
import { getDb, findProjectRoot } from '../db/connection.js';
import {
  listAllDeadEnds,
  listAllExperiments,
  listActiveExperiments,
  getAllCircuitBreakerStates,
  insertAuditProposal,
  getPendingAuditProposal,
  resolveAuditProposal,
  insertObjectiveHistory,
  insertNote,
  updateExperimentStatus,
} from '../db/queries.js';
import { adminTransitionAndPersist } from '../state/machine.js';
import { ExperimentStatus } from '../state/types.js';
import { spawnAgent } from '../agents/spawn.js';
import { extractStructuredData } from '../agents/parse.js';
import { loadConfig, resetConfigCache, readFileOrEmpty } from '../config.js';
import { autoCommit } from '../git.js';
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

  // --accept: accept pending objective rewrite proposal
  if (args.includes('--accept')) {
    const proposal = getPendingAuditProposal(db);
    if (!proposal) {
      fmt.warn('No pending audit proposal to accept.');
      return;
    }

    const config = loadConfig(root);
    const previousObjective = config.project?.objective ?? '';

    // Update config.json
    const configPath = path.join(root, '.majlis', 'config.json');
    const rawConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    rawConfig.project = rawConfig.project || {};
    rawConfig.project.objective = proposal.proposed_objective;
    fs.writeFileSync(configPath, JSON.stringify(rawConfig, null, 2) + '\n');
    resetConfigCache();

    // Record in objective_history
    insertObjectiveHistory(db, proposal.proposed_objective, previousObjective, proposal.reason, 'audit');

    // Reset active non-terminal experiments to classified
    const activeExps = listActiveExperiments(db);
    for (const exp of activeExps) {
      insertNote(db, null, exp.id, 'objective-change',
        `Objective changed: "${previousObjective}" → "${proposal.proposed_objective}"`);
      adminTransitionAndPersist(db, exp.id, exp.status as ExperimentStatus, ExperimentStatus.CLASSIFIED, 'objective_reset');
    }

    // Resolve proposal
    resolveAuditProposal(db, proposal.id, 'accepted');
    autoCommit(root, `audit: accept objective rewrite`);

    fmt.success(`Objective updated: "${proposal.proposed_objective}"`);
    if (activeExps.length > 0) {
      fmt.info(`${activeExps.length} active experiment(s) reset to classified.`);
    }
    return;
  }

  // --reject: dismiss pending objective rewrite proposal
  if (args.includes('--reject')) {
    const proposal = getPendingAuditProposal(db);
    if (!proposal) {
      fmt.warn('No pending audit proposal to reject.');
      return;
    }
    resolveAuditProposal(db, proposal.id, 'rejected');
    fmt.info('Audit proposal rejected.');
    return;
  }

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

  const synthesis = readFileOrEmpty(path.join(root, 'docs', 'synthesis', 'current.md'));

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
    `4. Is there a simpler formulation? If the classification has grown complex, something may be wrong.\n` +
    `5. If the classification is fundamentally misaligned, propose a rewrite.\n` +
    `   Include: <!-- majlis-json {"objective_rewrite": {"proposed_objective": "...", "reason": "..."}} -->\n` +
    `   Only include objective_rewrite if genuinely needed.\n\n` +
    `Output: either "classification confirmed — continue" or "re-classify from X" with a specific proposal.`;

  const result = await spawnAgent('builder', {
    synthesis,
    taskPrompt: auditPrompt,
  }, root);

  // Check for objective rewrite proposal in structured output
  const structured = result.structured;
  let rewrite = structured?.objective_rewrite;

  // Fallback: try extracting from raw output if not in structured
  if (!rewrite && result.output) {
    const extracted = await extractStructuredData('builder', result.output);
    rewrite = extracted.data?.objective_rewrite;
  }

  if (rewrite) {
    insertAuditProposal(db, rewrite.proposed_objective, rewrite.reason, result.output.slice(0, 5000));
    console.log();
    fmt.header('Objective Rewrite Proposed');
    console.log(`  Current:  ${config.project?.objective ?? '(none)'}`);
    console.log(`  Proposed: ${rewrite.proposed_objective}`);
    console.log(`  Reason:   ${rewrite.reason}`);
    console.log();
    fmt.info('Run `majlis audit --accept` or `majlis audit --reject`.');
  } else {
    fmt.success('Purpose audit complete. Review the output above.');
  }
}
