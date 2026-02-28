export interface FixtureConfig {
  gate?: boolean;       // If true, regression on this fixture blocks merge
}

export interface MajlisConfig {
  project: {
    name: string;
    description: string;
    objective: string;
  };
  metrics: {
    command: string;
    fixtures: Record<string, FixtureConfig> | string[];
    tracked: Record<string, { direction: string; target?: number }>;
  };
  build: {
    pre_measure: string | null;
    post_measure: string | null;
  };
  cycle: {
    compression_interval: number;
    circuit_breaker_threshold: number;
    require_doubt_before_verify: boolean;
    require_challenge_before_verify: boolean;
    auto_baseline_on_new_experiment: boolean;
  };
  models: Record<string, string>;
}

export interface Experiment {
  id: number;
  slug: string;
  branch: string;
  status: string;
  classification_ref: string | null;
  sub_type: string | null;
  hypothesis: string | null;
  builder_guidance: string | null;
  depends_on: string | null;       // slug of prerequisite experiment
  context_files: string | null;    // JSON array of relative file paths
  gate_rejection_reason: string | null;  // set when gatekeeper rejects; cleared on override
  created_at: string;
  updated_at: string;
}

export interface Decision {
  id: number;
  experiment_id: number;
  description: string;
  evidence_level: string;
  justification: string;
  status: string;
  overturned_by: number | null;
  created_at: string;
}

export interface MetricSnapshot {
  id: number;
  experiment_id: number;
  phase: string;
  fixture: string;
  metric_name: string;
  metric_value: number;
  captured_at: string;
}

export interface DeadEnd {
  id: number;
  experiment_id: number;
  approach: string;
  why_failed: string;
  structural_constraint: string;
  sub_type: string | null;
  category: 'structural' | 'procedural';
  created_at: string;
}

export interface Verification {
  id: number;
  experiment_id: number;
  component: string;
  grade: string;
  provenance_intact: number | null;
  content_correct: number | null;
  notes: string | null;
  created_at: string;
}

export interface Doubt {
  id: number;
  experiment_id: number;
  claim_doubted: string;
  evidence_level_of_claim: string;
  evidence_for_doubt: string;
  severity: string;
  resolution: string | null;
  created_at: string;
}

export interface SubTypeFailure {
  sub_type: string;
  experiment_id: number;
  grade: string;
  created_at: string;
}

export interface Session {
  id: number;
  intent: string;
  experiment_id: number | null;
  started_at: string;
  ended_at: string | null;
  accomplished: string | null;
  unfinished: string | null;
  new_fragility: string | null;
}

export interface Compression {
  id: number;
  session_count_since_last: number;
  synthesis_size_before: number;
  synthesis_size_after: number;
  created_at: string;
}

export interface MetricComparison {
  fixture: string;
  metric: string;
  before: number;
  after: number;
  delta: number;
  regression: boolean;
  gate: boolean;                   // true if this fixture is a regression gate
}
