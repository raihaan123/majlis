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
  [ExperimentStatus.RESOLVED]:    [ExperimentStatus.COMPRESSED, ExperimentStatus.BUILDING],  // cycle-back skips gate
  [ExperimentStatus.COMPRESSED]:  [ExperimentStatus.MERGED, ExperimentStatus.BUILDING],      // cycle-back skips gate
  [ExperimentStatus.MERGED]:      [],
  [ExperimentStatus.DEAD_END]:    [],
};

export type Grade = 'sound' | 'good' | 'weak' | 'rejected';

export const GRADE_ORDER: Grade[] = ['rejected', 'weak', 'good', 'sound'];
