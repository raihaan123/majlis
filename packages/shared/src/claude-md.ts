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

export function claudeMdContent(name: string, objective: string): string {
  return `# ${name}

${objective ? `**Objective:** ${objective}\n` : ''}## Majlis Protocol

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
}
