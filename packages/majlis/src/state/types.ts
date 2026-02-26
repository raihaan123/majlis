// PRD v2 §4.1 — exact state machine
export enum ExperimentStatus {
  CLASSIFIED = 'classified',
  REFRAMED = 'reframed',
  GATED = 'gated',
  BUILDING = 'building',
  BUILT = 'built',
  CHALLENGED = 'challenged',
  DOUBTED = 'doubted',
  SCOUTED = 'scouted',
  VERIFYING = 'verifying',
  VERIFIED = 'verified',
  RESOLVED = 'resolved',
  COMPRESSED = 'compressed',
  MERGED = 'merged',
  DEAD_END = 'dead_end',
}

// Valid transitions — enforced, not suggested
export const TRANSITIONS: Record<ExperimentStatus, ExperimentStatus[]> = {
  [ExperimentStatus.CLASSIFIED]:  [ExperimentStatus.REFRAMED, ExperimentStatus.GATED],
  [ExperimentStatus.REFRAMED]:    [ExperimentStatus.GATED],
  [ExperimentStatus.GATED]:       [ExperimentStatus.BUILDING, ExperimentStatus.GATED],  // self-loop for rejected hypotheses
  [ExperimentStatus.BUILDING]:    [ExperimentStatus.BUILT, ExperimentStatus.BUILDING],  // self-loop for retry after truncation
  [ExperimentStatus.BUILT]:       [ExperimentStatus.CHALLENGED, ExperimentStatus.DOUBTED],
  [ExperimentStatus.CHALLENGED]:  [ExperimentStatus.DOUBTED, ExperimentStatus.VERIFYING],
  [ExperimentStatus.DOUBTED]:     [ExperimentStatus.CHALLENGED, ExperimentStatus.SCOUTED, ExperimentStatus.VERIFYING],
  [ExperimentStatus.SCOUTED]:     [ExperimentStatus.VERIFYING],
  [ExperimentStatus.VERIFYING]:   [ExperimentStatus.VERIFIED],
  [ExperimentStatus.VERIFIED]:    [ExperimentStatus.RESOLVED],
  [ExperimentStatus.RESOLVED]:    [ExperimentStatus.COMPRESSED, ExperimentStatus.BUILDING, ExperimentStatus.MERGED, ExperimentStatus.DEAD_END],
  [ExperimentStatus.COMPRESSED]:  [ExperimentStatus.MERGED, ExperimentStatus.BUILDING],      // cycle-back skips gate
  [ExperimentStatus.MERGED]:      [],
  [ExperimentStatus.DEAD_END]:    [],
};

export type Grade = 'sound' | 'good' | 'weak' | 'rejected';

export const GRADE_ORDER: Grade[] = ['rejected', 'weak', 'good', 'sound'];

// Admin (force) transition reasons — bypass normal TRANSITIONS for recovery / bootstrap
export type AdminReason = 'revert' | 'circuit_breaker' | 'error_recovery' | 'bootstrap';

/**
 * Allowed admin transitions per reason.
 * Each entry maps a reason to a validator: (current, target) → boolean.
 */
export const ADMIN_TRANSITIONS: Record<AdminReason, (current: ExperimentStatus, target: ExperimentStatus) => boolean> = {
  revert: (current, target) =>
    target === ExperimentStatus.DEAD_END && !isTerminalStatus(current),
  circuit_breaker: (current, target) =>
    target === ExperimentStatus.DEAD_END && !isTerminalStatus(current),
  error_recovery: (current, target) =>
    target === ExperimentStatus.DEAD_END && !isTerminalStatus(current),
  bootstrap: (current, target) =>
    current === ExperimentStatus.CLASSIFIED && target === ExperimentStatus.REFRAMED,
};

/** Check if a status is terminal (no valid outgoing transitions). */
function isTerminalStatus(status: ExperimentStatus): boolean {
  return TRANSITIONS[status].length === 0;
}
