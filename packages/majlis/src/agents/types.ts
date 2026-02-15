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
  taskPrompt?: string;
  sub_type?: string;
}

/**
 * The JSON schema agents should embed in <!-- majlis-json --> blocks.
 */
export const EXTRACTION_SCHEMA = `{
  "decisions": [{ "description": "string", "evidence_level": "proof|test|strong_consensus|consensus|analogy|judgment", "justification": "string" }],
  "grades": [{ "component": "string", "grade": "sound|good|weak|rejected", "provenance_intact": true, "content_correct": true, "notes": "string" }],
  "doubts": [{ "claim_doubted": "string", "evidence_level_of_claim": "string", "evidence_for_doubt": "string", "severity": "minor|moderate|critical" }],
  "guidance": "string (actionable builder guidance)",
  "doubt_resolutions": [{ "doubt_id": 0, "resolution": "confirmed|dismissed|inconclusive" }]
}`;
