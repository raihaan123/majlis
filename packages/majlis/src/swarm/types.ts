import type { Experiment } from '../types.js';
import type { Grade } from '../state/types.js';

export interface WorktreeInfo {
  path: string;
  branch: string;
  slug: string;
  hypothesis: string;
  paddedNum: string;
}

export interface SwarmExperimentResult {
  worktree: WorktreeInfo;
  experiment: Experiment | null;
  finalStatus: string;
  overallGrade: Grade | null;
  costUsd: number;
  stepCount: number;
  error?: string;
}

export interface SwarmSummary {
  goal: string;
  parallelCount: number;
  results: SwarmExperimentResult[];
  bestExperiment: SwarmExperimentResult | null;
  totalCostUsd: number;
  mergedCount: number;
  deadEndCount: number;
  errorCount: number;
}
