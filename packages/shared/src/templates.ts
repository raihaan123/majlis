export const DOC_TEMPLATES: Record<string, string> = {
  'experiments/_TEMPLATE.md': `# Experiment: {{title}}

**Hypothesis:** {{hypothesis}}
**Branch:** {{branch}}
**Status:** {{status}}
**Sub-type:** {{sub_type}}
**Created:** {{date}}

## Approach

[Describe the approach]

## Decisions

- [evidence_level] Decision description — justification

## Results

[Describe the results]

## Metrics

| Fixture | Metric | Before | After | Delta |
|---------|--------|--------|-------|-------|
| | | | | |

<!-- majlis-json
{
  "decisions": [],
  "grades": []
}
-->
`,
  'decisions/_TEMPLATE.md': `# Decision: {{title}}

**Evidence Level:** {{evidence_level}}
**Experiment:** {{experiment}}
**Date:** {{date}}

## Description

[What was decided]

## Justification

[Why this decision was made, referencing evidence]

## Alternatives Considered

[What else was considered and why it was rejected]

<!-- majlis-json
{
  "decisions": [
    { "description": "", "evidence_level": "", "justification": "" }
  ]
}
-->
`,
  'classification/_TEMPLATE.md': `# Classification: {{domain}}

**Date:** {{date}}

## Problem Domain

[Describe the problem domain]

## Sub-Types

### 1. {{sub_type_1}}
- **Description:**
- **Canonical form:**
- **Known constraints:**

### 2. {{sub_type_2}}
- **Description:**
- **Canonical form:**
- **Known constraints:**

## Relationships

[How sub-types relate to each other]
`,
  'doubts/_TEMPLATE.md': `# Doubt Document — Against Experiment {{experiment}}

**Critic:** {{agent}}
**Date:** {{date}}

## Doubt 1: {{title}}

**Claim doubted:** {{claim}}
**Evidence level of claim:** {{evidence_level}}
**Severity:** {{severity}}

**Evidence for doubt:**
[Specific evidence — a prior experiment, inconsistency, untested case, or false analogy]

<!-- majlis-json
{
  "doubts": [
    { "claim_doubted": "", "evidence_level_of_claim": "", "evidence_for_doubt": "", "severity": "critical" }
  ]
}
-->
`,
  'challenges/_TEMPLATE.md': `# Challenge Document — Against Experiment {{experiment}}

**Adversary:** {{agent}}
**Date:** {{date}}

## Challenge 1: {{title}}

**Constructed case:**
[Specific input or condition designed to break the approach]

**Reasoning:**
[Why this case should break the approach — what assumption does it violate?]

## Challenge 2: {{title}}

**Constructed case:**
[Specific input or condition]

**Reasoning:**
[Why this should break]

<!-- majlis-json
{
  "challenges": [
    { "description": "", "reasoning": "" }
  ]
}
-->
`,
  'verification/_TEMPLATE.md': `# Verification Report — Experiment {{experiment}}

**Verifier:** {{agent}}
**Date:** {{date}}

## Provenance Check (Isnad)

| Component | Traceable | Chain intact | Notes |
|-----------|-----------|--------------|-------|
| | yes/no | yes/no | |

## Content Check (Matn)

| Component | Tests pass | Consistent | Grade | Notes |
|-----------|-----------|------------|-------|-------|
| | yes/no | yes/no | sound/good/weak/rejected | |

## Doubt Resolution

| Doubt | Resolution | Evidence |
|-------|------------|----------|
| | confirmed/dismissed/inconclusive | |

<!-- majlis-json
{
  "grades": [
    { "component": "", "grade": "sound", "provenance_intact": true, "content_correct": true, "notes": "" }
  ],
  "doubt_resolutions": [
    { "doubt_id": 0, "resolution": "confirmed" }
  ]
}
-->
`,
  'reframes/_TEMPLATE.md': `# Reframe: {{domain}}

**Reframer:** {{agent}}
**Date:** {{date}}

## Independent Decomposition

[How this problem should be decomposed — without seeing the builder's approach]

## Natural Joints

[Where does this problem naturally divide?]

## Cross-Domain Analogies

[What analogies from other domains apply?]

## Comparison with Existing Classification

[Structural divergences from the current classification]

## Divergences (Most Valuable Signals)

[Where the independent decomposition differs from the builder's classification]
`,
  'rihla/_TEMPLATE.md': `# Rihla (Scout Report): {{topic}}

**Date:** {{date}}

## Problem (Domain-Neutral)

[Describe the problem in domain-neutral terms]

## Alternative Approaches Found

### 1. {{approach}}
- **Source:**
- **Description:**
- **Applicability:**

## Known Limitations of Current Approach

[What external sources say about where this approach fails]

## Cross-Domain Analogues

[Structurally similar problems in unrelated domains]
`,
};

export const DOC_DIRS: string[] = [
  'inbox', 'experiments', 'decisions', 'classification',
  'doubts', 'challenges', 'verification', 'reframes', 'rihla',
  'synthesis', 'diagnosis',
];

export const WORKFLOW_MD = `# Majlis Workflow — Quick Reference

## The Cycle

\`\`\`
1. CLASSIFY   → Taxonomy before solution (Al-Khwarizmi)
2. REFRAME    → Independent decomposition (Al-Biruni)
3. GATE       → Hypothesis quality check ('Ilm al-'Ilal)
4. BUILD      → Write code with tagged decisions (Ijtihad)
5. CHALLENGE  → Construct breaking inputs (Ibn al-Haytham)
6. DOUBT      → Systematic challenge with evidence (Shukuk)
7. SCOUT      → External search for alternatives (Rihla)
8. VERIFY     → Provenance + content checks (Isnad + Matn)
9. RESOLVE    → Route based on grades
10. COMPRESS  → Shorter and denser (Hifz)
\`\`\`

## Resolution
- **Sound** → Merge
- **Good** → Merge + add gaps to fragility map
- **Weak** → Cycle back with synthesised guidance
- **Rejected** → Dead-end with structural constraint

## Circuit Breaker
3+ weak/rejected on same sub-type → Maqasid Check (purpose audit)

## Evidence Hierarchy
1. Proof → 2. Test → 3a. Strong Consensus → 3b. Consensus → 4. Analogy → 5. Judgment

## Commands
| Action | Command |
|--------|---------|
| Initialize | \`majlis init\` |
| Status | \`majlis status\` |
| New experiment | \`majlis new "hypothesis"\` |
| Baseline metrics | \`majlis baseline\` |
| Measure metrics | \`majlis measure\` |
| Compare metrics | \`majlis compare\` |
| Next step | \`majlis next\` |
| Auto cycle | \`majlis next --auto\` |
| Autonomous | \`majlis run "goal"\` |
| Session start | \`majlis session start "intent"\` |
| Session end | \`majlis session end\` |
| Compress | \`majlis compress\` |
| Audit | \`majlis audit "objective"\` |
`;

export const SYNTHESIS_STARTERS: Record<string, string> = {
  'current.md': '# Project Synthesis\n\n*No experiments yet. Run `majlis new "hypothesis"` to begin.*\n',
  'fragility.md': '# Fragility Map\n\n*No fragility recorded yet.*\n',
  'dead-ends.md': '# Dead-End Registry\n\n*No dead-ends recorded yet.*\n',
};
