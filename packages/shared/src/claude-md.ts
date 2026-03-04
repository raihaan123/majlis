export const CLAUDE_MD_SECTION = `
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
- Stray thoughts → \`docs/inbox/\`.
- Every session ends with \`majlis session end\`.

### Before Building
- Read \`docs/synthesis/current.md\` for compressed project state.
- Run \`majlis dead-ends --sub-type <relevant>\` for structural constraints.
- Run \`majlis decisions --level judgment\` for provisional decisions to challenge.
- Run \`majlis brief\` for a context dump of the current experiment state.

### Capturing Observations
- \`majlis note "text" --tag hypothesis\` — save observations to the DB (injected into agent contexts).
- \`majlis journal "text"\` — timestamped breadcrumbs during manual hacking.
- \`majlis catch-up "description" --diff HEAD~3..HEAD\` — create experiment retroactively from manual work.

### Chain Integrity
- If an experiment you depend on is dead-ended, your experiment is flagged as "weakened chain".
- Run \`majlis status\` to see chain warnings. Revert or proceed at your own risk.

### Verification Review
- If \`require_human_verify\` is enabled, experiments pause at \`verified\` for human review.
- Run \`majlis resolve\` to proceed or \`majlis resolve --reject\` to dead-end.

### Purpose Audit
- Circuit breaker trips (3+ failures on a sub-type) trigger a Maqasid Check.
- If the audit proposes an objective rewrite, run \`majlis audit --accept\` or \`--reject\`.

### Compression Trigger
- Run \`majlis status\` — it will warn when compression is due.

### Current State
Run \`majlis status\` for live experiment state and cycle position.
`;

export function claudeMdContent(name: string, objective: string): string {
  return `# ${name}

${objective ? `**Objective:** ${objective}\n` : ''}${CLAUDE_MD_SECTION}`;
}
