// PRD v2 §4.1 — exact state machine
export enum ExperimentStatus {
  CLASSIFIED = 'classified',
  REFRAMED = 'reframed',
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
  [ExperimentStatus.CLASSIFIED]:  [ExperimentStatus.REFRAMED, ExperimentStatus.BUILDING],
  [ExperimentStatus.REFRAMED]:    [ExperimentStatus.BUILDING],
  [ExperimentStatus.BUILDING]:    [ExperimentStatus.BUILT],
  [ExperimentStatus.BUILT]:       [ExperimentStatus.CHALLENGED, ExperimentStatus.DOUBTED],
  [ExperimentStatus.CHALLENGED]:  [ExperimentStatus.DOUBTED, ExperimentStatus.VERIFYING],
  [ExperimentStatus.DOUBTED]:     [ExperimentStatus.CHALLENGED, ExperimentStatus.SCOUTED, ExperimentStatus.VERIFYING],
  [ExperimentStatus.SCOUTED]:     [ExperimentStatus.VERIFYING],
  [ExperimentStatus.VERIFYING]:   [ExperimentStatus.VERIFIED],
  [ExperimentStatus.VERIFIED]:    [ExperimentStatus.RESOLVED],
  [ExperimentStatus.RESOLVED]:    [ExperimentStatus.COMPRESSED, ExperimentStatus.BUILDING],
  [ExperimentStatus.COMPRESSED]:  [ExperimentStatus.MERGED, ExperimentStatus.BUILDING],
  [ExperimentStatus.MERGED]:      [],
  [ExperimentStatus.DEAD_END]:    [],
};

export type Grade = 'sound' | 'good' | 'weak' | 'rejected';

export const GRADE_ORDER: Grade[] = ['rejected', 'weak', 'good', 'sound'];
