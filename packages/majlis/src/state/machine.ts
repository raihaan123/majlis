import { ExperimentStatus, TRANSITIONS } from './types.js';
import type { Experiment } from '../types.js';

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

  // compressed → advance to merged (final step before terminal)
  if (status === ExperimentStatus.COMPRESSED) {
    return valid.includes(ExperimentStatus.MERGED)
      ? ExperimentStatus.MERGED
      : valid[0];
  }

  // Default: first valid transition
  return valid[0];
}
