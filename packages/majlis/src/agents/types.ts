import type { Decision, Doubt, Verification } from '../types.js';

export interface AgentDefinition {
  name: string;
  model: string;
  tools: string[];
  systemPrompt: string;
}

export interface AgentResult {
  output: string;
  structured: StructuredOutput | null;
  truncated: boolean;
  extractionTier: 1 | 2 | 3 | null;  // Which parsing tier produced structured output
}

export interface StructuredOutput {
  decisions?: Array<{
    description: string;
    evidence_level: string;
    justification: string;
  }>;
  grades?: Array<{
    component: string;
    grade: string;
    provenance_intact?: boolean;
    content_correct?: boolean;
    notes?: string;
  }>;
  doubts?: Array<{
    claim_doubted: string;
    evidence_level_of_claim: string;
    evidence_for_doubt: string;
    severity: string;
  }>;
  challenges?: Array<{
    description: string;
    reasoning: string;
  }>;
  guidance?: string;
  doubt_resolutions?: Array<{
    doubt_id: number;
    resolution: string;
  }>;
  // Gate output (gatekeeper)
  gate_decision?: 'approve' | 'reject' | 'flag';
  reason?: string;
  stale_references?: string[];
  overlapping_dead_ends?: number[];
  // Reframer output
  reframe?: {
    decomposition: string;
    divergences: string[];
    recommendation: string;
  };
  // Scout output
  findings?: Array<{
    approach: string;
    source: string;
    relevance: string;
    contradicts_current: boolean;
  }>;
  // Compressor output
  compression_report?: {
    synthesis_delta: string;
    new_dead_ends: string[];
    fragility_changes: string[];
  };
  // Diagnostician output
  diagnosis?: {
    root_causes: string[];
    patterns: string[];
    evidence_gaps: string[];
    investigation_directions: string[];
  };
  // Cartographer output (scan)
  architecture?: {
    modules: string[];
    entry_points: string[];
    key_abstractions: string[];
    dependency_graph: string;
  };
  // Toolsmith output (scan)
  toolsmith?: {
    metrics_command: string | null;
    build_command: string | null;
    test_command: string | null;
    test_framework: string | null;
    pre_measure: string | null;
    post_measure: string | null;
    fixtures: Record<string, unknown>;
    tracked: Record<string, { direction: string; target?: number }>;
    verification_output: string;
    issues: string[];
  };
  // Builder abandon (Tradition 13: Ijtihad — qualified judgment that hypothesis is invalid)
  abandon?: {
    reason: string;
    structural_constraint: string;
  };
  // Post-mortem analysis output
  postmortem?: {
    why_failed: string;
    structural_constraint: string;
    category: 'structural' | 'procedural';
  };
}

export interface AgentContext {
  experiment?: {
    id: number;
    slug: string;
    hypothesis: string | null;
    status: string;
    sub_type: string | null;
    builder_guidance: string | null;
  };
  deadEnds?: Array<{
    approach: string;
    why_failed: string;
    structural_constraint: string;
  }>;
  fragility?: string;
  synthesis?: string;
  doubts?: Doubt[];
  challenges?: string;
  verificationReport?: Verification[];
  confirmedDoubts?: Doubt[];
  metricComparisons?: Array<{
    fixture: string;
    metric: string;
    before: number;
    after: number;
    delta: number;
    regression: boolean;
    gate: boolean;
  }>;
  supplementaryContext?: string;   // Experiment-scoped files (Tradition 13: Ijtihad)
  experimentLineage?: string;      // Structured DB records for related experiments (Tradition 1: Hafiz)
  taskPrompt?: string;
  sub_type?: string;
}

/**
 * The JSON schema agents should embed in <!-- majlis-json --> blocks.
 * Generic fallback for roles without a specific schema.
 */
export const EXTRACTION_SCHEMA = `{
  "decisions": [{ "description": "string", "evidence_level": "proof|test|strong_consensus|consensus|analogy|judgment", "justification": "string" }],
  "grades": [{ "component": "string", "grade": "sound|good|weak|rejected", "provenance_intact": true, "content_correct": true, "notes": "string" }],
  "doubts": [{ "claim_doubted": "string", "evidence_level_of_claim": "string", "evidence_for_doubt": "string", "severity": "minor|moderate|critical" }],
  "guidance": "string (actionable builder guidance)",
  "doubt_resolutions": [{ "doubt_id": 0, "resolution": "confirmed|dismissed|inconclusive" }]
}`;

/**
 * Per-role extraction schemas — used by Tier 3 (Haiku) extraction.
 * Each role has an exact JSON shape it should produce.
 */
export function getExtractionSchema(role: string): string {
  switch (role) {
    case 'builder':
      return '{"decisions": [{"description": "string", "evidence_level": "proof|test|strong_consensus|consensus|analogy|judgment", "justification": "string"}], "abandon": {"reason": "string", "structural_constraint": "string"}}';
    case 'critic':
      return '{"doubts": [{"claim_doubted": "string", "evidence_level_of_claim": "string", "evidence_for_doubt": "string", "severity": "minor|moderate|critical"}]}';
    case 'adversary':
      return '{"challenges": [{"description": "string", "reasoning": "string"}]}';
    case 'verifier':
      return '{"grades": [{"component": "string", "grade": "sound|good|weak|rejected", "provenance_intact": true, "content_correct": true, "notes": "string"}], "doubt_resolutions": [{"doubt_id": 0, "resolution": "confirmed|dismissed|inconclusive"}]}';
    case 'gatekeeper':
      return '{"gate_decision": "approve|reject|flag", "reason": "string", "stale_references": ["string"], "overlapping_dead_ends": [0]}';
    case 'reframer':
      return '{"reframe": {"decomposition": "string", "divergences": ["string"], "recommendation": "string"}}';
    case 'scout':
      return '{"findings": [{"approach": "string", "source": "string", "relevance": "string", "contradicts_current": true}]}';
    case 'compressor':
      return '{"compression_report": {"synthesis_delta": "string", "new_dead_ends": ["string"], "fragility_changes": ["string"]}}';
    case 'diagnostician':
      return '{"diagnosis": {"root_causes": ["string"], "patterns": ["string"], "evidence_gaps": ["string"], "investigation_directions": ["string"]}}';
    case 'cartographer':
      return '{"architecture": {"modules": ["string"], "entry_points": ["string"], "key_abstractions": ["string"], "dependency_graph": "string"}}';
    case 'toolsmith':
      return '{"toolsmith": {"metrics_command": "string|null", "build_command": "string|null", "test_command": "string|null", "test_framework": "string|null", "pre_measure": "string|null", "post_measure": "string|null", "fixtures": {}, "tracked": {}, "verification_output": "string", "issues": ["string"]}}';
    case 'postmortem':
      return '{"postmortem": {"why_failed": "string", "structural_constraint": "string", "category": "structural|procedural"}}';
    default:
      return EXTRACTION_SCHEMA;
  }
}

/**
 * Per-role required fields — for output validation.
 */
export const ROLE_REQUIRED_FIELDS: Record<string, string[]> = {
  builder:    ['decisions'],
  critic:     ['doubts'],
  adversary:  ['challenges'],
  verifier:   ['grades'],
  gatekeeper: ['gate_decision'],
  reframer:   ['reframe'],
  scout:      ['findings'],
  compressor: ['compression_report'],
  diagnostician: ['diagnosis'],
  cartographer:  ['architecture'],
  toolsmith:     ['toolsmith'],
  postmortem:    ['postmortem'],
};
