import { getDb, findProjectRoot } from '../db/connection.js';
import {
  getExperimentBySlug,
  getLatestExperiment,
  getSessionsSinceCompression,
  hasDoubts as dbHasDoubts,
  checkCircuitBreaker,
  insertDeadEnd,
} from '../db/queries.js';
import { validNext, determineNextStep, isTerminal, transitionAndPersist, adminTransitionAndPersist } from '../state/machine.js';
import { ExperimentStatus } from '../state/types.js';
import { hasChallenges } from '../db/queries.js';
import type { MajlisConfig, Experiment } from '../types.js';
import { loadConfig } from '../config.js';
import { cycle, resolveCmd } from './cycle.js';
import { audit } from './audit.js';
import * as fmt from '../output/format.js';

export async function next(args: string[], isJson: boolean): Promise<void> {
  const root = findProjectRoot();
  if (!root) throw new Error('Not in a Majlis project. Run `majlis init` first.');

  const db = getDb(root);
  const config = loadConfig(root);

  // Get experiment
  const slugArg = args.filter(a => !a.startsWith('--'))[0];
  let exp: Experiment;
  if (slugArg) {
    const found = getExperimentBySlug(db, slugArg);
    if (!found) throw new Error(`Experiment not found: ${slugArg}`);
    exp = found;
  } else {
    const found = getLatestExperiment(db);
    if (!found) throw new Error('No active experiments. Run `majlis new "hypothesis"` first.');
    exp = found;
  }

  const auto = args.includes('--auto');

  if (auto) {
    await runAutoLoop(db, exp, config, root, isJson);
  } else {
    await runNextStep(db, exp, config, root, isJson);
  }
}

async function runNextStep(
  db: ReturnType<typeof getDb>,
  exp: Experiment,
  config: MajlisConfig,
  root: string,
  isJson: boolean,
): Promise<void> {
  const currentStatus = exp.status as ExperimentStatus;
  const valid = validNext(currentStatus);

  if (valid.length === 0) {
    if (isJson) {
      console.log(JSON.stringify({ experiment: exp.slug, status: exp.status, terminal: true }));
    } else {
      fmt.info(`Experiment ${exp.slug} is terminal (${exp.status}).`);
    }
    return;
  }

  // Check circuit breakers — dead-end the experiment to prevent further cycling
  if (exp.sub_type && checkCircuitBreaker(db, exp.sub_type, config.cycle.circuit_breaker_threshold)) {
    fmt.warn(`Circuit breaker: ${exp.sub_type} has ${config.cycle.circuit_breaker_threshold}+ failures.`);
    insertDeadEnd(db, exp.id, exp.hypothesis ?? exp.slug,
      `Circuit breaker tripped for ${exp.sub_type}`,
      `Sub-type ${exp.sub_type} exceeded ${config.cycle.circuit_breaker_threshold} failures`,
      exp.sub_type, 'procedural');
    adminTransitionAndPersist(db, exp.id, exp.status as ExperimentStatus, ExperimentStatus.DEAD_END, 'circuit_breaker');
    fmt.warn('Experiment dead-ended. Triggering Maqasid Check (purpose audit).');
    await audit([config.project?.objective ?? '']);
    return;
  }

  // Check compression timer
  const sessionsSinceCompression = getSessionsSinceCompression(db);
  if (sessionsSinceCompression >= config.cycle.compression_interval) {
    fmt.warn(
      `${sessionsSinceCompression} sessions since last compression. ` +
      `Consider running: majlis compress`
    );
  }

  // Determine next step
  const expHasDoubts = dbHasDoubts(db, exp.id);
  const expHasChallenges = hasChallenges(db, exp.id);
  const nextStep = determineNextStep(exp, valid, expHasDoubts, expHasChallenges);

  if (isJson) {
    console.log(JSON.stringify({
      experiment: exp.slug,
      current_status: exp.status,
      next_step: nextStep,
      valid_transitions: valid,
    }));
    return;
  }

  fmt.info(`${exp.slug}: ${exp.status} → ${nextStep}`);

  // Execute the step
  await executeStep(nextStep, exp, root);
}

async function runAutoLoop(
  db: ReturnType<typeof getDb>,
  exp: Experiment,
  config: MajlisConfig,
  root: string,
  isJson: boolean,
): Promise<void> {
  const MAX_ITERATIONS = 20;
  let iteration = 0;

  fmt.header(`Auto mode — ${exp.slug}`);

  while (iteration < MAX_ITERATIONS) {
    iteration++;

    // Refresh experiment state
    const freshExp = getExperimentBySlug(db, exp.slug);
    if (!freshExp) break;
    exp = freshExp;

    if (isTerminal(exp.status as ExperimentStatus)) {
      fmt.success(`Experiment ${exp.slug} reached terminal state: ${exp.status}`);
      break;
    }

    // Check circuit breaker — dead-end the experiment to prevent further cycling
    if (exp.sub_type && checkCircuitBreaker(db, exp.sub_type, config.cycle.circuit_breaker_threshold)) {
      fmt.warn(`Circuit breaker tripped for ${exp.sub_type}. Stopping auto mode.`);
      insertDeadEnd(db, exp.id, exp.hypothesis ?? exp.slug,
        `Circuit breaker tripped for ${exp.sub_type}`,
        `Sub-type ${exp.sub_type} exceeded ${config.cycle.circuit_breaker_threshold} failures`,
        exp.sub_type, 'procedural');
      adminTransitionAndPersist(db, exp.id, exp.status as ExperimentStatus, ExperimentStatus.DEAD_END, 'circuit_breaker');
      await audit([config.project?.objective ?? '']);
      break;
    }

    const valid = validNext(exp.status as ExperimentStatus);
    if (valid.length === 0) break;

    const expHasDoubts = dbHasDoubts(db, exp.id);
    const expHasChallenges = hasChallenges(db, exp.id);
    const nextStep = determineNextStep(exp, valid, expHasDoubts, expHasChallenges);

    fmt.info(`[${iteration}/${MAX_ITERATIONS}] ${exp.slug}: ${exp.status} → ${nextStep}`);

    await executeStep(nextStep, exp, root);
  }

  if (iteration >= MAX_ITERATIONS) {
    fmt.warn(`Reached maximum iterations (${MAX_ITERATIONS}). Stopping auto mode.`);
  }
}

async function executeStep(
  step: ExperimentStatus,
  exp: Experiment,
  root: string,
): Promise<void> {
  const expArgs = [exp.slug];

  switch (step) {
    case ExperimentStatus.BUILDING:
      await cycle('build', expArgs);
      break;
    case ExperimentStatus.CHALLENGED:
      await cycle('challenge', expArgs);
      break;
    case ExperimentStatus.DOUBTED:
      await cycle('doubt', expArgs);
      break;
    case ExperimentStatus.SCOUTED:
      await cycle('scout', expArgs);
      break;
    case ExperimentStatus.VERIFYING:
      await cycle('verify', expArgs);
      break;
    case ExperimentStatus.RESOLVED:
      await resolveCmd(expArgs);
      break;
    case ExperimentStatus.COMPRESSED:
      await cycle('compress', []);
      // Compression is session-level but the experiment status needs advancing
      transitionAndPersist(getDb(root), exp.id, exp.status as ExperimentStatus, ExperimentStatus.COMPRESSED);
      fmt.info(`Experiment ${exp.slug} compressed.`);
      break;
    case ExperimentStatus.GATED:
      await cycle('gate', expArgs);
      break;
    case ExperimentStatus.REFRAMED: {
      // Reframing is session-level (already done before experiment creation).
      // Just advance the status so the next iteration picks up gating.
      const currentStatus = exp.status as ExperimentStatus;
      if (currentStatus === ExperimentStatus.CLASSIFIED) {
        adminTransitionAndPersist(getDb(root), exp.id, currentStatus, ExperimentStatus.REFRAMED, 'bootstrap');
      } else {
        transitionAndPersist(getDb(root), exp.id, currentStatus, ExperimentStatus.REFRAMED);
      }
      fmt.info(`Reframe acknowledged for ${exp.slug}. Proceeding to gate.`);
      break;
    }
    case ExperimentStatus.MERGED:
      // Terminal: advance status (covers manual compress → next flow)
      transitionAndPersist(getDb(root), exp.id, exp.status as ExperimentStatus, ExperimentStatus.MERGED);
      fmt.success(`Experiment ${exp.slug} merged.`);
      break;
    case ExperimentStatus.DEAD_END:
      fmt.info(`Experiment ${exp.slug} is dead-ended. No further action.`);
      break;
    default:
      fmt.warn(`Don't know how to execute step: ${step}`);
  }
}

