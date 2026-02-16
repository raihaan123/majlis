import * as fs from 'node:fs';
import * as path from 'node:path';
import { getDb, closeDb, resetDb } from '../db/connection.js';
import * as fmt from '../output/format.js';

const DEFAULT_CONFIG = {
  project: {
    name: '',
    description: '',
    objective: '',
  },
  metrics: {
    command: 'echo \'{"fixtures":{}}\'',
    fixtures: [],
    tracked: {},
  },
  build: {
    pre_measure: null,
    post_measure: null,
  },
  cycle: {
    compression_interval: 5,
    circuit_breaker_threshold: 3,
    require_doubt_before_verify: true,
    require_challenge_before_verify: false,
    auto_baseline_on_new_experiment: true,
  },
  models: {
    builder: 'opus',
    critic: 'opus',
    adversary: 'opus',
    verifier: 'opus',
    reframer: 'opus',
    compressor: 'opus',
  },
};

const AGENT_DEFINITIONS: Record<string, string> = {
  builder: `---
name: builder
model: opus
tools: [Read, Write, Edit, Bash, Glob, Grep]
---
You are the Builder. You write code, run experiments, and make technical decisions.

Before building:
1. Read docs/synthesis/current.md for project state
2. Read the dead-ends provided in your context — these are structural constraints
3. Check docs/classification/ for problem taxonomy
4. Check docs/experiments/ for prior work

## Scope Constraint (CRITICAL)

You get ONE attempt per cycle. Your job is:
1. Read and diagnose — understand the problem thoroughly
2. Form ONE hypothesis about what to fix
3. Implement ONE focused change (not a multi-step debug session)
4. Run the benchmark ONCE to see the result
5. Update the experiment doc in docs/experiments/ — fill in Approach, Results, and Metrics sections. This is NOT optional.
6. Output the structured majlis-json block with your decisions
7. STOP

Do NOT iterate. Do NOT try multiple approaches. Do NOT debug your own fix.
If your change doesn't work, document why and let the cycle continue —
the adversary, critic, and verifier will help diagnose what went wrong.
The cycle will come back to you with their insights.

If you find yourself wanting to "try one more thing," that's the signal to stop
and write up what you learned. The other agents exist precisely for this reason.

## During building:
- Tag EVERY decision: proof / test / strong-consensus / consensus / analogy / judgment
- When making judgment-level decisions, state: "This is judgment — reasoning without precedent"
- Run baseline metrics BEFORE making changes
- Run comparison metrics AFTER making changes (once)

You may NOT verify your own work or mark your own decisions as proven.
Output your decisions in structured format so they can be recorded in the database.

## Structured Output Format
At the end of your work, include a <!-- majlis-json --> block with your decisions:
\`\`\`
<!-- majlis-json
{
  "decisions": [
    { "description": "...", "evidence_level": "judgment|test|proof|analogy|consensus|strong_consensus", "justification": "..." }
  ]
}
-->
\`\`\``,

  critic: `---
name: critic
model: opus
tools: [Read, Glob, Grep]
---
You are the Critic. You practise constructive doubt.

You receive the builder's OUTPUT only — never its reasoning chain.
Read the experiment log, related prior experiments, classification, and synthesis.

For each doubt:
- What specific claim, decision, or assumption you doubt
- WHY: reference a prior experiment, inconsistency, untested case, or false analogy
- Evidence level of the doubted decision
- Severity: minor / moderate / critical

Rules:
- Every doubt MUST reference evidence. "This feels wrong" is not a doubt.
- You may NOT suggest fixes. Identify problems only.
- Focus on judgment and analogy-level decisions first.
- You may NOT modify any files. Produce your doubt document as output only.
- Do NOT attempt to write files. The framework saves your output automatically.

## Structured Output Format
<!-- majlis-json
{
  "doubts": [
    { "claim_doubted": "...", "evidence_level_of_claim": "judgment", "evidence_for_doubt": "...", "severity": "critical|moderate|minor" }
  ]
}
-->`,

  adversary: `---
name: adversary
model: opus
tools: [Read, Glob, Grep]
---
You are the Adversary. You do NOT review code for bugs.
You reason about problem structure to CONSTRUCT pathological cases.

For each approach the builder takes, ask:
- What input would make this fail?
- What boundary condition was not tested?
- What degenerate case collapses a distinction the algorithm relies on?
- What distribution shift invalidates the assumptions?
- Under what conditions do two things the builder treats as distinct become identical?

Produce constructed counterexamples with reasoning.
Do NOT suggest fixes. Do NOT modify files. Do NOT attempt to write files.
The framework saves your output automatically.

## Structured Output Format
<!-- majlis-json
{
  "challenges": [
    { "description": "...", "reasoning": "..." }
  ]
}
-->`,

  verifier: `---
name: verifier
model: opus
tools: [Read, Glob, Grep, Bash]
---
You are the Verifier. Perform dual verification:

## Scope Constraint (CRITICAL)

You must produce your structured output (grades + doubt resolutions) within your turn budget.
Do NOT exhaustively test every doubt and challenge — prioritize the critical ones.
For each doubt/challenge: one targeted check is enough. Confirm, dismiss, or mark inconclusive.
Reserve your final turns for writing the structured majlis-json output.

The framework saves your output automatically. Do NOT attempt to write files.

## PROVENANCE CHECK:
- Can every piece of code trace to an experiment or decision?
- Is the chain unbroken from requirement -> classification -> experiment -> code?
- Flag any broken chains.

## CONTENT CHECK:
- Does the code do what the experiment log says?
- Run at most 3-5 targeted diagnostic scripts, focused on the critical doubts/challenges.
- Do NOT run exhaustive diagnostics on every claim.

Grade each component: sound / good / weak / rejected
Grade each doubt/challenge: confirmed / dismissed (with evidence) / inconclusive

## Structured Output Format
<!-- majlis-json
{
  "grades": [
    { "component": "...", "grade": "sound|good|weak|rejected", "provenance_intact": true, "content_correct": true, "notes": "..." }
  ],
  "doubt_resolutions": [
    { "doubt_id": 0, "resolution": "confirmed|dismissed|inconclusive" }
  ]
}
-->`,

  reframer: `---
name: reframer
model: opus
tools: [Read, Glob, Grep]
---
You are the Reframer. You receive ONLY:
- The original problem statement
- The current classification document
- The synthesis and dead-end registry

You do NOT read builder code, experiments, or solutions.

Independently propose:
- How should this problem be decomposed?
- What are the natural joints?
- What analogies from other domains apply?
- What framework would a different field use?

Compare your decomposition with the existing classification.
Flag structural divergences — these are the most valuable signals.

Produce your reframe document as output. Do NOT attempt to write files.
The framework saves your output automatically.`,

  compressor: `---
name: compressor
model: opus
tools: [Read, Write, Edit, Glob, Grep]
---
You are the Compressor. Hold the entire project in view and compress it.

1. Read ALL experiments, decisions, doubts, challenges, verification reports,
   reframes, and recent diffs.
2. Cross-reference: same question in different language? contradicting decisions?
   workaround masking root cause?
3. Update fragility map: thin coverage, weak components, untested judgment
   decisions, broken provenance.
4. Update dead-end registry: compress rejected experiments into structural constraints.
5. REWRITE synthesis — shorter and denser. If it's growing, you're accumulating,
   not compressing.
6. Review classification: new sub-types? resolved sub-types?

You may NOT write code, make decisions, or run experiments.

## Structured Output Format
<!-- majlis-json
{
  "guidance": "Summary of compression findings and updated state"
}
-->`,

  scout: `---
name: scout
model: opus
tools: [Read, Glob, Grep, WebSearch]
---
You are the Scout. You practise rihla — travel in search of knowledge.

Your job is to search externally for alternative approaches, contradictory evidence,
and perspectives from other fields that could inform the current experiment.

For the given experiment:
1. Describe the problem in domain-neutral terms
2. Search for alternative approaches in other fields or frameworks
3. Identify known limitations of the current approach from external sources
4. Find structurally similar problems in unrelated domains
5. Report what you find on its own terms — do not judge or filter

Rules:
- Present findings neutrally. Report each approach on its own terms.
- Note where external approaches contradict the current one — these are the most valuable signals.
- You may NOT modify code or make decisions. Produce your rihla document as output only.
- Do NOT attempt to write files. The framework saves your output automatically.

## Structured Output Format
<!-- majlis-json
{
  "decisions": []
}
-->`,
};

const SLASH_COMMANDS: Record<string, { description: string; body: string }> = {
  classify: {
    description: 'Classify a problem domain into canonical sub-types before building',
    body: `Run \`majlis classify "$ARGUMENTS"\` and follow its output.
If the CLI is not installed, act as the Builder in classification mode.
Read docs/synthesis/current.md and docs/synthesis/dead-ends.md for context.
Enumerate and classify all canonical sub-types of: $ARGUMENTS
Produce a classification document following docs/classification/_TEMPLATE.md.`,
  },
  doubt: {
    description: 'Run a constructive doubt pass on an experiment',
    body: `Run \`majlis doubt $ARGUMENTS\` to spawn the critic agent.
If the CLI is not installed, act as the Critic directly.
Doubt the experiment at $ARGUMENTS. Produce a doubt document
following docs/doubts/_TEMPLATE.md.`,
  },
  challenge: {
    description: 'Construct adversarial test cases for an experiment',
    body: `Run \`majlis challenge $ARGUMENTS\` to spawn the adversary agent.
If the CLI is not installed, act as the Adversary directly.
Construct pathological inputs designed to break the approach in $ARGUMENTS.
Produce a challenge document following docs/challenges/_TEMPLATE.md.`,
  },
  verify: {
    description: 'Verify correctness and provenance of an experiment',
    body: `Run \`majlis verify $ARGUMENTS\` to spawn the verifier agent.
If the CLI is not installed, act as the Verifier directly.
Perform dual verification (provenance + content) on $ARGUMENTS.
Produce a verification report following docs/verification/_TEMPLATE.md.`,
  },
  reframe: {
    description: 'Independently reframe a problem from scratch',
    body: `Run \`majlis reframe $ARGUMENTS\` to spawn the reframer agent.
If the CLI is not installed, act as the Reframer directly.
You receive ONLY the problem statement and classification — NOT builder code.
Independently decompose $ARGUMENTS and compare with existing classification.`,
  },
  compress: {
    description: 'Compress project state into dense synthesis',
    body: `Run \`majlis compress\` to spawn the compressor agent.
If the CLI is not installed, act as the Compressor directly.
Read everything. Rewrite docs/synthesis/current.md shorter and denser.
Update fragility map and dead-end registry.`,
  },
  scout: {
    description: 'Search externally for alternative approaches',
    body: `Run \`majlis scout $ARGUMENTS\` to spawn the scout agent.
If the CLI is not installed, search for alternative approaches to $ARGUMENTS.
Look for: limitations of current approach, alternative formulations from other fields,
structurally similar problems in unrelated domains.
Produce a rihla document at docs/rihla/.`,
  },
  audit: {
    description: 'Maqasid check — is the frame right?',
    body: `Run \`majlis audit "$ARGUMENTS"\` for a purpose audit.
If the CLI is not installed, review: original objective, current classification,
recent failures, dead-ends. Ask: is the classification serving the objective?
Would we decompose differently with what we now know?`,
  },
};

const HOOKS_CONFIG = {
  hooks: {
    SessionStart: [
      {
        hooks: [
          {
            type: 'command' as const,
            command: "majlis status --json 2>/dev/null || true",
          },
        ],
      },
    ],
    PreToolUse: [
      {
        matcher: 'Bash',
        hooks: [
          {
            type: 'command' as const,
            command: "majlis check-commit 2>/dev/null || true",
            timeout: 10,
          },
        ],
      },
    ],
    SubagentStop: [
      {
        hooks: [
          {
            type: 'command' as const,
            command: "echo 'Subagent completed. Run majlis next to continue the cycle.'",
            timeout: 5,
          },
        ],
      },
    ],
  },
};

const CLAUDE_MD_SECTION = `
## Majlis Protocol

This project uses the Majlis Framework for structured multi-agent problem solving.
See \`docs/workflow.md\` for the full cycle. See \`.claude/agents/\` for role definitions (source of truth in \`.majlis/agents/\`).

### Evidence Hierarchy (tag every decision)
1. **Proof** — mathematical proof. Overturn requires error in proof.
2. **Test** — empirical test. Overturn requires showing test insufficiency.
3a. **Strong Consensus** — convergence across independent approaches.
3b. **Consensus** — agreement from same-model experiments.
4. **Analogy** — justified by similarity to prior work.
5. **Judgment** — independent reasoning without precedent.

### Session Discipline
- One intent per session. Declare it with \`majlis session start "intent"\`.
- Stray thoughts → Telegram (Scribe) or docs/inbox/.
- Every session ends with \`majlis session end\`.

### Before Building
- Read \`docs/synthesis/current.md\` for compressed project state.
- Run \`majlis dead-ends --sub-type <relevant>\` for structural constraints.
- Run \`majlis decisions --level judgment\` for provisional decisions to challenge.

### Compression Trigger
- Run \`majlis status\` — it will warn when compression is due.

### Current State
Run \`majlis status\` for live experiment state and cycle position.
`;

const WORKFLOW_MD = `# Majlis Workflow — Quick Reference

## The Cycle

\`\`\`
1. CLASSIFY   → Taxonomy before solution (Al-Khwarizmi)
2. REFRAME    → Independent decomposition (Al-Biruni)
3. BUILD      → Write code with tagged decisions (Ijtihad)
4. CHALLENGE  → Construct breaking inputs (Ibn al-Haytham)
5. DOUBT      → Systematic challenge with evidence (Shukuk)
6. SCOUT      → External search for alternatives (Rihla)
7. VERIFY     → Provenance + content checks (Isnad + Matn)
8. RESOLVE    → Route based on grades
9. COMPRESS   → Shorter and denser (Hifz)
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

const DOC_TEMPLATES: Record<string, string> = {
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

export async function init(_args: string[]): Promise<void> {
  const projectRoot = process.cwd();

  fmt.header('Initializing Majlis');

  // Create .majlis/ directory
  const majlisDir = path.join(projectRoot, '.majlis');
  mkdirSafe(majlisDir);
  fmt.info('Created .majlis/');

  // Initialize SQLite DB (triggers migrations)
  resetDb();
  const db = getDb(projectRoot);
  fmt.info('Created SQLite database with schema');
  closeDb();
  resetDb();

  // Write config.json
  const configPath = path.join(majlisDir, 'config.json');
  if (!fs.existsSync(configPath)) {
    // Try to detect project name from package.json
    const config = { ...DEFAULT_CONFIG };
    const pkgPath = path.join(projectRoot, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
        config.project.name = pkg.name ?? '';
        config.project.description = pkg.description ?? '';
      } catch { /* ignore */ }
    }
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    fmt.info('Created .majlis/config.json');
  }

  // Write agent definitions to .majlis/agents/
  const agentsDir = path.join(majlisDir, 'agents');
  mkdirSafe(agentsDir);
  for (const [name, content] of Object.entries(AGENT_DEFINITIONS)) {
    fs.writeFileSync(path.join(agentsDir, `${name}.md`), content);
  }
  fmt.info('Created agent definitions in .majlis/agents/');

  // Copy agents to .claude/agents/ for Claude Code discovery
  const claudeAgentsDir = path.join(projectRoot, '.claude', 'agents');
  mkdirSafe(claudeAgentsDir);
  for (const [name, content] of Object.entries(AGENT_DEFINITIONS)) {
    fs.writeFileSync(path.join(claudeAgentsDir, `${name}.md`), content);
  }
  fmt.info('Copied agent definitions to .claude/agents/');

  // Write slash commands to .claude/commands/
  const commandsDir = path.join(projectRoot, '.claude', 'commands');
  mkdirSafe(commandsDir);
  for (const [name, cmd] of Object.entries(SLASH_COMMANDS)) {
    const content = `---\ndescription: ${cmd.description}\n---\n${cmd.body}\n`;
    fs.writeFileSync(path.join(commandsDir, `${name}.md`), content);
  }
  fmt.info('Created slash commands in .claude/commands/');

  // Write hooks to .claude/settings.json
  const settingsPath = path.join(projectRoot, '.claude', 'settings.json');
  if (fs.existsSync(settingsPath)) {
    // Merge hooks into existing settings
    try {
      const existing = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
      existing.hooks = { ...existing.hooks, ...HOOKS_CONFIG.hooks };
      fs.writeFileSync(settingsPath, JSON.stringify(existing, null, 2));
    } catch {
      fs.writeFileSync(settingsPath, JSON.stringify(HOOKS_CONFIG, null, 2));
    }
  } else {
    fs.writeFileSync(settingsPath, JSON.stringify(HOOKS_CONFIG, null, 2));
  }
  fmt.info('Created hooks in .claude/settings.json');

  // Create docs/ tree with templates
  const docsDir = path.join(projectRoot, 'docs');
  const docDirs = [
    'inbox', 'experiments', 'decisions', 'classification',
    'doubts', 'challenges', 'verification', 'reframes', 'rihla',
    'synthesis',
  ];
  for (const dir of docDirs) {
    mkdirSafe(path.join(docsDir, dir));
  }

  // Write templates
  for (const [relativePath, content] of Object.entries(DOC_TEMPLATES)) {
    const fullPath = path.join(docsDir, relativePath);
    if (!fs.existsSync(fullPath)) {
      fs.writeFileSync(fullPath, content);
    }
  }
  fmt.info('Created docs/ tree with templates');

  // Write synthesis starters
  const synthesisDir = path.join(docsDir, 'synthesis');
  const currentPath = path.join(synthesisDir, 'current.md');
  if (!fs.existsSync(currentPath)) {
    fs.writeFileSync(currentPath, '# Project Synthesis\n\n*No experiments yet. Run `majlis new "hypothesis"` to begin.*\n');
  }
  const fragPath = path.join(synthesisDir, 'fragility.md');
  if (!fs.existsSync(fragPath)) {
    fs.writeFileSync(fragPath, '# Fragility Map\n\n*No fragility recorded yet.*\n');
  }
  const deadEndsPath = path.join(synthesisDir, 'dead-ends.md');
  if (!fs.existsSync(deadEndsPath)) {
    fs.writeFileSync(deadEndsPath, '# Dead-End Registry\n\n*No dead-ends recorded yet.*\n');
  }

  // Write workflow.md
  const workflowPath = path.join(docsDir, 'workflow.md');
  if (!fs.existsSync(workflowPath)) {
    fs.writeFileSync(workflowPath, WORKFLOW_MD);
  }
  fmt.info('Created docs/workflow.md');

  // Append Majlis protocol to CLAUDE.md
  const claudeMdPath = path.join(projectRoot, 'CLAUDE.md');
  if (fs.existsSync(claudeMdPath)) {
    const existing = fs.readFileSync(claudeMdPath, 'utf-8');
    if (!existing.includes('## Majlis Protocol')) {
      fs.writeFileSync(claudeMdPath, existing + '\n' + CLAUDE_MD_SECTION);
      fmt.info('Appended Majlis Protocol to existing CLAUDE.md');
    }
  } else {
    fs.writeFileSync(claudeMdPath, `# ${path.basename(projectRoot)}\n${CLAUDE_MD_SECTION}`);
    fmt.info('Created CLAUDE.md with Majlis Protocol');
  }

  fmt.success('Majlis initialized. Run `majlis status` to see project state.');
}

function mkdirSafe(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}
