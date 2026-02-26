export const SLASH_COMMANDS: Record<string, { description: string; body: string }> = {
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
  diagnose: {
    description: 'Deep project-wide diagnostic analysis',
    body: `Run \`majlis diagnose $ARGUMENTS\` for deep diagnosis.
If the CLI is not installed, perform a deep diagnostic analysis.
Read docs/synthesis/current.md, fragility.md, dead-ends.md, and all experiments.
Identify root causes, recurring patterns, evidence gaps, and investigation directions.
Do NOT modify project code — analysis only.`,
  },
  scan: {
    description: 'Scan existing project to auto-detect config and write synthesis',
    body: `Run \`majlis scan\` to analyze the existing codebase.
This spawns two agents in parallel:
- Cartographer: maps architecture → docs/synthesis/current.md + fragility.md
- Toolsmith: verifies toolchain → .majlis/scripts/metrics.sh + config.json
Use --force to overwrite existing synthesis files.`,
  },
  resync: {
    description: 'Update stale synthesis after project evolved without Majlis',
    body: `Run \`majlis resync\` to bring Majlis back up to speed.
Unlike scan (which starts from zero), resync starts from existing knowledge.
It assesses staleness, then re-runs cartographer (always) and toolsmith (if needed)
with the old synthesis and DB history as context.
Use --check to see the staleness report without making changes.
Use --force to skip active experiment checks.`,
  },
};
