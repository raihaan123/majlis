import { ExperimentStatus, TRANSITIONS, ADMIN_TRANSITIONS } from './types.js';
import type { AdminReason } from './types.js';
import type { Experiment } from '../types.js';
import { updateExperimentStatus } from '../db/queries.js';
import type Database from 'better-sqlite3';

/**
 * Validate and execute a state transition.
 * Throws if the transition is invalid.
 */
export function transition(current: ExperimentStatus, target: ExperimentStatus): ExperimentStatus {
  const valid = TRANSITIONS[current];
  if (!valid.includes(target)) {
    throw new Error(
      `Invalid transition: ${current} → ${target}. Valid: [${valid.join(', ')}]`
    );
  }
  return target;
}

/**
 * Return all valid next states from the current state.
 */
export function validNext(current: ExperimentStatus): ExperimentStatus[] {
  return TRANSITIONS[current];
}

/**
 * Check if a status is terminal (no further transitions possible).
 */
export function isTerminal(status: ExperimentStatus): boolean {
  return TRANSITIONS[status].length === 0;
}

/**
 * Validate and execute an admin (force) transition.
 * Throws if the transition is not allowed for the given reason.
 */
export function adminTransition(
  current: ExperimentStatus,
  target: ExperimentStatus,
  reason: AdminReason,
): ExperimentStatus {
  const allowed = ADMIN_TRANSITIONS[reason];
  if (!allowed(current, target)) {
    throw new Error(
      `Invalid admin transition (${reason}): ${current} → ${target}`
    );
  }
  return target;
}

/**
 * Validate a normal transition and persist it to the database atomically.
 */
export function transitionAndPersist(
  db: Database.Database,
  experimentId: number,
  current: ExperimentStatus,
  target: ExperimentStatus,
): ExperimentStatus {
  const result = transition(current, target);
  updateExperimentStatus(db, experimentId, result);
  return result;
}

/**
 * Validate an admin transition and persist it to the database atomically.
 */
export function adminTransitionAndPersist(
  db: Database.Database,
  experimentId: number,
  current: ExperimentStatus,
  target: ExperimentStatus,
  reason: AdminReason,
): ExperimentStatus {
  const result = adminTransition(current, target, reason);
  updateExperimentStatus(db, experimentId, result);
  return result;
}

/**
 * Deterministic routing logic from PRD v2 §4.4.
 * Determines the next step based on experiment state and available data.
 */
export function determineNextStep(
  exp: Experiment,
  valid: ExperimentStatus[],
  hasDoubts: boolean,
  hasChallenges: boolean,
): ExperimentStatus {
  if (valid.length === 0) {
    throw new Error(`Experiment ${exp.slug} is terminal (${exp.status})`);
  }

  const status = exp.status as ExperimentStatus;

  // classified or reframed → must gate before building
  if (status === ExperimentStatus.CLASSIFIED || status === ExperimentStatus.REFRAMED) {
    return valid.includes(ExperimentStatus.GATED)
      ? ExperimentStatus.GATED
      : valid[0];
  }

  // gated → proceed to building
  if (status === ExperimentStatus.GATED) {
    return valid.includes(ExperimentStatus.BUILDING)
      ? ExperimentStatus.BUILDING
      : valid[0];
  }

  // built + no doubts → must doubt before verifying
  if (status === ExperimentStatus.BUILT && !hasDoubts) {
    return valid.includes(ExperimentStatus.DOUBTED)
      ? ExperimentStatus.DOUBTED
      : valid[0];
  }

  // doubted + no challenges → should challenge if not yet done
  if (status === ExperimentStatus.DOUBTED && !hasChallenges) {
    return valid.includes(ExperimentStatus.CHALLENGED)
      ? ExperimentStatus.CHALLENGED
      : valid[0];
  }

  // doubted or challenged → ready to verify
  if (status === ExperimentStatus.DOUBTED || status === ExperimentStatus.CHALLENGED) {
    if (valid.includes(ExperimentStatus.VERIFYING)) {
      return ExperimentStatus.VERIFYING;
    }
  }

  // building → re-run the builder (self-loop triggers cycle('build')).
  // The builder itself transitions to 'built' when done.
  // This handles both first builds and cycle-backs from weak verification.
  if (status === ExperimentStatus.BUILDING) {
    return ExperimentStatus.BUILDING;
  }

  // scouted → advance to verifying
  if (status === ExperimentStatus.SCOUTED) {
    return valid.includes(ExperimentStatus.VERIFYING)
      ? ExperimentStatus.VERIFYING
      : valid[0];
  }

  // verified → advance to resolved
  if (status === ExperimentStatus.VERIFIED) {
    return valid.includes(ExperimentStatus.RESOLVED)
      ? ExperimentStatus.RESOLVED
      : valid[0];
  }

  // resolved → handled by resolve.ts internally; if we reach here,
  // advance to compress (the next session-level step)
  if (status === ExperimentStatus.RESOLVED) {
    return valid.includes(ExperimentStatus.COMPRESSED)
      ? ExperimentStatus.COMPRESSED
      : valid[0];
  }

  // compressed → advance to merged (final step before terminal)
  if (status === ExperimentStatus.COMPRESSED) {
    return valid.includes(ExperimentStatus.MERGED)
      ? ExperimentStatus.MERGED
      : valid[0];
  }

  // Default: first valid transition
  return valid[0];
}
