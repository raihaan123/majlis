import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync, execFileSync } from 'node:child_process';
import { getDb, findProjectRoot } from '../db/connection.js';
import {
  getExperimentBySlug,
  getLatestExperiment,
  updateExperimentStatus,
  getDoubtsByExperiment,
  getVerificationsByExperiment,
  getConfirmedDoubts,
  getMetricsByExperimentAndPhase,
  getSessionsSinceCompression,
  recordCompression,
  listAllDeadEnds,
  listDeadEndsBySubType,
  listStructuralDeadEnds,
  listStructuralDeadEndsBySubType,
  getBuilderGuidance,
  storeBuilderGuidance,
  storeGateRejection,
  exportForCompressor,
  insertDecision,
  insertDoubt,
  insertChallenge,
  insertVerification,
  insertReframe,
  insertFinding,
  insertDeadEnd,
  insertMetric,
  updateDoubtResolution,
  exportExperimentLineage,
} from '../db/queries.js';
import { transition, adminTransitionAndPersist } from '../state/machine.js';
import { ExperimentStatus } from '../state/types.js';
import { spawnAgent } from '../agents/spawn.js';
import { extractStructuredData } from '../agents/parse.js';
import { resolve as resolveExperiment } from '../resolve.js';
import type { Experiment, Doubt } from '../types.js';
import type { StructuredOutput } from '../agents/types.js';
import { loadConfig, readFileOrEmpty, truncateContext, CONTEXT_LIMITS } from '../config.js';
import { parseMetricsOutput, compareMetrics } from '../metrics.js';
import { autoCommit, handleDeadEndGit } from '../git.js';
import * as fmt from '../output/format.js';

export async function cycle(step: string, args: string[]): Promise<void> {
  const root = findProjectRoot();
  if (!root) throw new Error('Not in a Majlis project. Run `majlis init` first.');

  const db = getDb(root);

  // Compress is session-level — no active experiment required
  if (step === 'compress') return doCompress(db, root);

  const exp = resolveExperimentArg(db, args);

  switch (step) {
    case 'build':
      return doBuild(db, exp, root);
    case 'challenge':
      return doChallenge(db, exp, root);
    case 'doubt':
      return doDoubt(db, exp, root);
    case 'scout':
      return doScout(db, exp, root);
    case 'verify':
      return doVerify(db, exp, root);
    case 'gate':
      return doGate(db, exp, root);
  }
}

export async function resolveCmd(args: string[]): Promise<void> {
  const root = findProjectRoot();
  if (!root) throw new Error('Not in a Majlis project. Run `majlis init` first.');

  const db = getDb(root);
  const exp = resolveExperimentArg(db, args);

  // Validate state: must be verified to resolve
  transition(exp.status as ExperimentStatus, ExperimentStatus.RESOLVED);

  // resolve() in resolve.ts sets the correct terminal status:
  //   sound/good → merged, weak → building, rejected → dead_end
  await resolveExperiment(db, exp, root);
}

/**
 * Execute a cycle step with explicit db/root params.
 * Used by the swarm runner which manages its own DB connections.
 */
export async function runStep(
  step: string,
  db: ReturnType<typeof getDb>,
  exp: Experiment,
  root: string,
): Promise<void> {
  switch (step) {
    case 'build': return doBuild(db, exp, root);
    case 'challenge': return doChallenge(db, exp, root);
    case 'doubt': return doDoubt(db, exp, root);
    case 'scout': return doScout(db, exp, root);
    case 'verify': return doVerify(db, exp, root);
    case 'gate': return doGate(db, exp, root);
    case 'compress': return doCompress(db, root);
  }
}

/**
 * Resolve with explicit db/root params.
 * Used by the swarm runner.
 */
export async function runResolve(
  db: ReturnType<typeof getDb>,
  exp: Experiment,
  root: string,
): Promise<void> {
  transition(exp.status as ExperimentStatus, ExperimentStatus.RESOLVED);
  await resolveExperiment(db, exp, root);
}

async function doGate(db: ReturnType<typeof getDb>, exp: Experiment, root: string): Promise<void> {
  transition(exp.status as ExperimentStatus, ExperimentStatus.GATED);

  // Gather context for the gatekeeper
  const synthesis = truncateContext(readFileOrEmpty(path.join(root, 'docs', 'synthesis', 'current.md')), CONTEXT_LIMITS.synthesis);
  const fragility = truncateContext(readFileOrEmpty(path.join(root, 'docs', 'synthesis', 'fragility.md')), CONTEXT_LIMITS.fragility);
  const structuralDeadEnds = exp.sub_type
    ? listStructuralDeadEndsBySubType(db, exp.sub_type)
    : listStructuralDeadEnds(db);

  const result = await spawnAgent('gatekeeper', {
    experiment: {
      id: exp.id,
      slug: exp.slug,
      hypothesis: exp.hypothesis,
      status: exp.status,
      sub_type: exp.sub_type,
      builder_guidance: null,
    },
    deadEnds: structuralDeadEnds.map(d => ({
      approach: d.approach,
      why_failed: d.why_failed,
      structural_constraint: d.structural_constraint,
    })),
    fragility,
    synthesis,
    taskPrompt:
      `Gate-check hypothesis for experiment ${exp.slug}:\n"${exp.hypothesis}"\n\n` +
      'This is a FAST gate — decide in 1-2 turns. Do NOT read source code or large files. ' +
      'Use the synthesis, dead-ends, and fragility provided in your context. ' +
      'At most, do one targeted grep to verify a function name exists.\n\n' +
      'Check: (a) stale references — does the hypothesis reference specific lines, functions, or structures that may not exist? ' +
      '(b) dead-end overlap — does this hypothesis repeat an approach already ruled out by structural dead-ends? ' +
      '(c) scope — is this a single focused change, or does it try to do multiple things?\n\n' +
      'Output your gate_decision as "approve", "reject", or "flag" with reasoning.',
  }, root);

  ingestStructuredOutput(db, exp.id, result.structured);

  const decision = result.structured?.gate_decision ?? 'approve';
  const reason = result.structured?.reason ?? '';

  if (decision === 'reject') {
    // Gate rejection pauses the experiment instead of auto-killing it.
    // The experiment stays at 'gated' with a rejection reason stored.
    // User can: `majlis next --override-gate` to proceed, or `majlis revert` to abandon.
    // Autonomous mode (run.ts) auto-dead-ends gate rejections since there's no human to dispute.
    updateExperimentStatus(db, exp.id, 'gated');
    storeGateRejection(db, exp.id, reason);
    fmt.warn(`Gate REJECTED for ${exp.slug}: ${reason}`);
    fmt.info('Run `majlis next --override-gate` to proceed anyway, or `majlis revert` to abandon.');
    return;
  } else {
    if (decision === 'flag') {
      fmt.warn(`Gate flagged concerns for ${exp.slug}: ${reason}`);
    }
    updateExperimentStatus(db, exp.id, 'gated');
    fmt.success(`Gate passed for ${exp.slug}. Run \`majlis build\` next.`);
  }
}

async function doBuild(db: ReturnType<typeof getDb>, exp: Experiment, root: string): Promise<void> {
  // Validate dependency — if this experiment depends on another, it must be merged first
  // Tradition 4 (Al-Khwarizmi): canonical forms have a natural ordering
  if (exp.depends_on) {
    const dep = getExperimentBySlug(db, exp.depends_on);
    if (!dep || dep.status !== 'merged') {
      throw new Error(
        `Experiment "${exp.slug}" depends on "${exp.depends_on}" which is ${dep ? dep.status : 'not found'}. ` +
        `Dependency must be merged before building.`
      );
    }
  }

  // Validate transition
  transition(exp.status as ExperimentStatus, ExperimentStatus.BUILDING);

  // Gather context
  const deadEnds = exp.sub_type ? listDeadEndsBySubType(db, exp.sub_type) : listAllDeadEnds(db);
  const builderGuidance = getBuilderGuidance(db, exp.id);

  const fragility = truncateContext(readFileOrEmpty(path.join(root, 'docs', 'synthesis', 'fragility.md')), CONTEXT_LIMITS.fragility);
  const synthesis = truncateContext(readFileOrEmpty(path.join(root, 'docs', 'synthesis', 'current.md')), CONTEXT_LIMITS.synthesis);

  // Confirmed doubts from previous cycles — builder MUST address these
  const confirmedDoubts = getConfirmedDoubts(db, exp.id);

  // Framework-controlled metrics: capture baseline BEFORE build
  // Skip if baseline already captured (e.g. by `majlis new --auto-baseline`)
  const config = loadConfig(root);
  const existingBaseline = getMetricsByExperimentAndPhase(db, exp.id, 'before');
  if (config.metrics?.command && existingBaseline.length === 0) {
    try {
      const output = execSync(config.metrics.command, {
        cwd: root, encoding: 'utf-8', timeout: 60_000,
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();
      const parsed = parseMetricsOutput(output);
      for (const m of parsed) {
        insertMetric(db, exp.id, 'before', m.fixture, m.metric_name, m.metric_value);
      }
      if (parsed.length > 0) fmt.info(`Captured ${parsed.length} baseline metric(s).`);
    } catch { fmt.warn('Could not capture baseline metrics.'); }
  }

  updateExperimentStatus(db, exp.id, 'building');

  // Build task prompt with confirmed doubts section
  let taskPrompt = builderGuidance
    ? `Previous attempt was weak. Here is guidance for this attempt:\n${builderGuidance}\n\nBuild the experiment: ${exp.hypothesis}`
    : `Build the experiment: ${exp.hypothesis}`;

  if (confirmedDoubts.length > 0) {
    taskPrompt += '\n\n## Confirmed Doubts (MUST address)\nThese weaknesses were confirmed by the verifier. Your build MUST address each one:\n';
    for (const d of confirmedDoubts) {
      taskPrompt += `- [${d.severity}] ${d.claim_doubted}: ${d.evidence_for_doubt}\n`;
    }
  }

  taskPrompt += `\n\nYour experiment doc: ${expDocRelPath(exp)}`;
  taskPrompt += '\n\nNote: The framework captures metrics automatically. Do NOT claim specific numbers unless quoting framework output.';

  // Load experiment-scoped context files (Tradition 13: Ijtihad)
  const supplementaryContext = loadExperimentContext(exp, root);

  // Fix #1: Experiment lineage — Tradition 1 (Hafiz), Tradition 14 (Shura)
  // Inject structured DB records so builder has canonical history, not just lossy synthesis
  const lineage = exportExperimentLineage(db, exp.sub_type);
  if (lineage) {
    taskPrompt += '\n\n' + lineage;
  }

  const result = await spawnAgent('builder', {
    experiment: {
      id: exp.id,
      slug: exp.slug,
      hypothesis: exp.hypothesis,
      status: 'building',
      sub_type: exp.sub_type,
      builder_guidance: builderGuidance,
    },
    deadEnds: deadEnds.map(d => ({
      approach: d.approach,
      why_failed: d.why_failed,
      structural_constraint: d.structural_constraint,
    })),
    fragility,
    synthesis,
    confirmedDoubts,
    supplementaryContext: supplementaryContext || undefined,
    experimentLineage: lineage || undefined,
    taskPrompt,
  }, root);

  // Ingest structured output
  ingestStructuredOutput(db, exp.id, result.structured);

  // Fix #5A: Builder abandon — Tradition 13 (Ijtihad): qualified judgment that hypothesis is invalid
  if (result.structured?.abandon) {
    insertDeadEnd(db, exp.id, exp.hypothesis ?? exp.slug,
      result.structured.abandon.reason,
      result.structured.abandon.structural_constraint,
      exp.sub_type, 'structural');
    adminTransitionAndPersist(db, exp.id, 'building' as ExperimentStatus, ExperimentStatus.DEAD_END, 'revert');
    handleDeadEndGit(exp, root);
    fmt.info(`Builder abandoned ${exp.slug}: ${result.structured.abandon.reason}`);
    return;
  }

  if (result.truncated && !result.structured) {
    // Builder hit max turns without producing structured output.
    // Try extractStructuredData on the full truncated output — the 3-tier parser
    // may find a <!-- majlis-json --> block buried before the truncation point.
    fmt.warn(`Builder was truncated (hit max turns) without producing structured output.`);
    const recovery = await extractStructuredData('builder', result.output);

    if (recovery.data && !recovery.data.abandon) {
      // Recovered structured data from the truncated output
      fmt.info(`Recovered structured output from truncated builder (tier ${recovery.tier}).`);
      ingestStructuredOutput(db, exp.id, recovery.data);

      // Run build gate if configured (same as normal path)
      if (config.build?.pre_measure) {
        try {
          const [cmd, ...cmdArgs] = config.build.pre_measure.split(/\s+/);
          execFileSync(cmd, cmdArgs, {
            cwd: root, encoding: 'utf-8', timeout: 30_000,
            stdio: ['pipe', 'pipe', 'pipe'],
          });
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          storeBuilderGuidance(db, exp.id,
            `Build verification failed after truncated recovery.\nError: ${errMsg.slice(0, 500)}`);
          fmt.warn(`Build verification failed for ${exp.slug}. Staying at 'building'.`);
          return;
        }
      }

      // Capture post-build metrics
      if (config.metrics?.command) {
        try {
          const output = execSync(config.metrics.command, {
            cwd: root, encoding: 'utf-8', timeout: 60_000,
            stdio: ['pipe', 'pipe', 'pipe'],
          }).trim();
          const parsed = parseMetricsOutput(output);
          for (const m of parsed) {
            insertMetric(db, exp.id, 'after', m.fixture, m.metric_name, m.metric_value);
          }
          if (parsed.length > 0) fmt.info(`Captured ${parsed.length} post-build metric(s).`);
        } catch { /* non-fatal */ }
      }

      gitCommitBuild(exp, root);

      // Provenance warning for tier 3 (same as normal path)
      if (recovery.tier === 3) {
        fmt.warn(`Builder output extracted via Haiku (tier 3). Data provenance degraded.`);
        const existing = getBuilderGuidance(db, exp.id) ?? '';
        storeBuilderGuidance(db, exp.id,
          existing + '\n[PROVENANCE WARNING] Builder structured output was reconstructed by a secondary model (tier 3). Treat reported decisions with additional scrutiny.');
      }

      updateExperimentStatus(db, exp.id, 'built');
      fmt.success(`Build complete for ${exp.slug} (recovered from truncation). Run \`majlis doubt\` or \`majlis challenge\` next.`);

    } else if (recovery.data?.abandon) {
      // Truncated but had an abandon block — honor it
      insertDeadEnd(db, exp.id, exp.hypothesis ?? exp.slug,
        recovery.data.abandon.reason,
        recovery.data.abandon.structural_constraint,
        exp.sub_type, 'structural');
      adminTransitionAndPersist(db, exp.id, 'building' as ExperimentStatus, ExperimentStatus.DEAD_END, 'revert');
      handleDeadEndGit(exp, root);
      fmt.info(`Builder abandoned ${exp.slug} (recovered from truncation): ${recovery.data.abandon.reason}`);

    } else {
      // No structured data found — extract guidance from tail of output
      const tail = result.output.slice(-2000).trim();
      if (tail) {
        storeBuilderGuidance(db, exp.id,
          `Builder was truncated. Last ~2000 chars of output:\n${tail}`);
      }
      fmt.warn(`Experiment stays at 'building'. Run \`majlis build\` to retry or \`majlis revert\` to abandon.`);
    }
  } else {
    // Fix #3: Build verification gate — Tradition 3 (Hadith): weak link invalidates chain
    // Tradition 15 (Tajwid): broken code is a distortion of the builder's intent
    if (config.build?.pre_measure) {
      try {
        const [cmd, ...cmdArgs] = config.build.pre_measure.split(/\s+/);
        execFileSync(cmd, cmdArgs, {
          cwd: root, encoding: 'utf-8', timeout: 30_000,
          stdio: ['pipe', 'pipe', 'pipe'],
        });
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        const guidance = `Build verification failed after builder completion. Code may be syntactically broken or incomplete.\nError: ${errMsg.slice(0, 500)}`;
        storeBuilderGuidance(db, exp.id, guidance);
        fmt.warn(`Build verification failed for ${exp.slug}. Staying at 'building'.`);
        fmt.warn(`Guidance stored for retry. Run \`majlis build\` to retry.`);
        return;
      }
    }

    // Framework-controlled metrics: capture AFTER build
    if (config.metrics?.command) {
      try {
        const output = execSync(config.metrics.command, {
          cwd: root, encoding: 'utf-8', timeout: 60_000,
          stdio: ['pipe', 'pipe', 'pipe'],
        }).trim();
        const parsed = parseMetricsOutput(output);
        for (const m of parsed) {
          insertMetric(db, exp.id, 'after', m.fixture, m.metric_name, m.metric_value);
        }
        if (parsed.length > 0) fmt.info(`Captured ${parsed.length} post-build metric(s).`);
      } catch { fmt.warn('Could not capture post-build metrics.'); }
    }

    // Auto-commit builder's changes on the experiment branch.
    // This ensures gitRevert() can cleanly discard the branch on rejection,
    // and gitMerge() has actual commits to merge on success.
    gitCommitBuild(exp, root);

    // Fix #4: Provenance flagging — Tradition 3 (Hadith): chain provenance
    // If builder output was extracted via tier 3 (Haiku), flag it for the verifier
    if (result.extractionTier === 3) {
      fmt.warn(`Builder output extracted via Haiku (tier 3). Data provenance degraded.`);
      const existing = getBuilderGuidance(db, exp.id) ?? '';
      storeBuilderGuidance(db, exp.id,
        existing + '\n[PROVENANCE WARNING] Builder structured output was reconstructed by a secondary model (tier 3). Treat reported decisions with additional scrutiny.');
    }

    updateExperimentStatus(db, exp.id, 'built');
    fmt.success(`Build complete for ${exp.slug}. Run \`majlis doubt\` or \`majlis challenge\` next.`);
  }
}

async function doChallenge(db: ReturnType<typeof getDb>, exp: Experiment, root: string): Promise<void> {
  transition(exp.status as ExperimentStatus, ExperimentStatus.CHALLENGED);

  // Get the actual code diff — adversary attacks the code, not prose
  let gitDiff = '';
  try {
    gitDiff = execSync('git diff main -- . ":!.majlis/"', {
      cwd: root, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch { /* no diff available */ }
  if (gitDiff.length > 8000) gitDiff = gitDiff.slice(0, 8000) + '\n[DIFF TRUNCATED]';

  const synthesis = truncateContext(readFileOrEmpty(path.join(root, 'docs', 'synthesis', 'current.md')), CONTEXT_LIMITS.synthesis);

  let taskPrompt = `Construct adversarial test cases for experiment ${exp.slug}: ${exp.hypothesis}`;
  if (gitDiff) {
    taskPrompt += `\n\n## Code Changes (git diff main)\n\`\`\`diff\n${gitDiff}\n\`\`\``;
  }

  const result = await spawnAgent('adversary', {
    experiment: {
      id: exp.id,
      slug: exp.slug,
      hypothesis: exp.hypothesis,
      status: exp.status,
      sub_type: exp.sub_type,
      builder_guidance: null,
    },
    synthesis,
    taskPrompt,
  }, root);

  ingestStructuredOutput(db, exp.id, result.structured);
  if (result.truncated && !result.structured) {
    fmt.warn(`Adversary was truncated without structured output. Experiment stays at current status.`);
  } else {
    updateExperimentStatus(db, exp.id, 'challenged');
    fmt.success(`Challenge complete for ${exp.slug}. Run \`majlis doubt\` or \`majlis verify\` next.`);
  }
}

async function doDoubt(db: ReturnType<typeof getDb>, exp: Experiment, root: string): Promise<void> {
  transition(exp.status as ExperimentStatus, ExperimentStatus.DOUBTED);

  // Read the builder's experiment doc (the artifact, NOT reasoning chain — Tradition 3)
  const expDocPath = path.join(root, expDocRelPath(exp));
  const experimentDoc = truncateContext(readFileOrEmpty(expDocPath), CONTEXT_LIMITS.experimentDoc);

  // Read synthesis for structural context
  const synthesis = truncateContext(readFileOrEmpty(path.join(root, 'docs', 'synthesis', 'current.md')), CONTEXT_LIMITS.synthesis);

  // Dead-ends — so critic can identify repeated patterns
  const deadEnds = exp.sub_type ? listDeadEndsBySubType(db, exp.sub_type) : listAllDeadEnds(db);

  let taskPrompt = `Doubt the work in experiment ${exp.slug}: ${exp.hypothesis}. Produce a doubt document with evidence for each doubt.`;
  if (experimentDoc) {
    taskPrompt += `\n\n## Experiment Document (builder's artifact)\n<experiment_doc>\n${experimentDoc}\n</experiment_doc>`;
  }

  const result = await spawnAgent('critic', {
    experiment: {
      id: exp.id,
      slug: exp.slug,
      hypothesis: exp.hypothesis,
      status: exp.status,
      sub_type: exp.sub_type,
      builder_guidance: null, // Critic does NOT see builder reasoning
    },
    synthesis,
    deadEnds: deadEnds.map(d => ({
      approach: d.approach,
      why_failed: d.why_failed,
      structural_constraint: d.structural_constraint,
    })),
    taskPrompt,
  }, root);

  ingestStructuredOutput(db, exp.id, result.structured);
  if (result.truncated && !result.structured) {
    fmt.warn(`Critic was truncated without structured output. Experiment stays at current status.`);
  } else {
    updateExperimentStatus(db, exp.id, 'doubted');
    fmt.success(`Doubt pass complete for ${exp.slug}. Run \`majlis challenge\` or \`majlis verify\` next.`);
  }
}

async function doScout(db: ReturnType<typeof getDb>, exp: Experiment, root: string): Promise<void> {
  transition(exp.status as ExperimentStatus, ExperimentStatus.SCOUTED);

  const synthesis = truncateContext(readFileOrEmpty(path.join(root, 'docs', 'synthesis', 'current.md')), CONTEXT_LIMITS.synthesis);
  const fragility = truncateContext(readFileOrEmpty(path.join(root, 'docs', 'synthesis', 'fragility.md')), CONTEXT_LIMITS.fragility);

  // Dead-ends — so scout searches for approaches that circumvent known structural constraints
  const deadEnds = exp.sub_type ? listDeadEndsBySubType(db, exp.sub_type) : listAllDeadEnds(db);
  const deadEndsSummary = deadEnds.map(d =>
    `- [${d.category ?? 'structural'}] ${d.approach}: ${d.why_failed}`
  ).join('\n');

  let taskPrompt = `Search for alternative approaches to the problem in experiment ${exp.slug}: ${exp.hypothesis}. Look for contradictory approaches, solutions from other fields, and known limitations of the current approach.`;
  if (deadEndsSummary) {
    taskPrompt += `\n\n## Known Dead Ends (avoid these approaches)\n${deadEndsSummary}`;
  }
  if (fragility) {
    taskPrompt += `\n\n## Fragility Map (target these weak areas)\n${fragility}`;
  }

  const result = await spawnAgent('scout', {
    experiment: {
      id: exp.id,
      slug: exp.slug,
      hypothesis: exp.hypothesis,
      status: exp.status,
      sub_type: exp.sub_type,
      builder_guidance: null,
    },
    synthesis,
    fragility,
    deadEnds: deadEnds.map(d => ({
      approach: d.approach,
      why_failed: d.why_failed,
      structural_constraint: d.structural_constraint,
    })),
    taskPrompt,
  }, root);

  ingestStructuredOutput(db, exp.id, result.structured);

  // Truncation guard — don't advance status without structured output
  if (result.truncated && !result.structured) {
    fmt.warn(`Scout was truncated without structured output. Experiment stays at current status.`);
    return;
  }

  updateExperimentStatus(db, exp.id, 'scouted');
  fmt.success(`Scout pass complete for ${exp.slug}. Run \`majlis verify\` next.`);
}

async function doVerify(db: ReturnType<typeof getDb>, exp: Experiment, root: string): Promise<void> {
  transition(exp.status as ExperimentStatus, ExperimentStatus.VERIFYING);

  const doubts = getDoubtsByExperiment(db, exp.id);

  // Read challenge documents if they exist
  const challengeDir = path.join(root, 'docs', 'challenges');
  let challenges = '';
  if (fs.existsSync(challengeDir)) {
    const files = fs.readdirSync(challengeDir)
      .filter(f => f.includes(exp.slug) && f.endsWith('.md'));
    for (const f of files) {
      challenges += fs.readFileSync(path.join(challengeDir, f), 'utf-8') + '\n\n';
    }
  }

  // Framework-captured metrics — GROUND TRUTH, not self-reported by builder
  // Tradition 15 (Tajwid): pass structured comparison, not raw numbers, to prevent
  // distortion in inter-agent handoffs
  const config = loadConfig(root);
  const metricComparisons = compareMetrics(db, exp.id, config);

  let metricsSection = '';
  if (metricComparisons.length > 0) {
    metricsSection = '\n\n## Framework-Captured Metrics (GROUND TRUTH — not self-reported by builder)\n';
    metricsSection += '| Fixture | Metric | Before | After | Delta | Regression | Gate |\n';
    metricsSection += '|---------|--------|--------|-------|-------|------------|------|\n';
    for (const c of metricComparisons) {
      metricsSection += `| ${c.fixture} | ${c.metric} | ${c.before} | ${c.after} | ${c.delta > 0 ? '+' : ''}${c.delta} | ${c.regression ? 'YES' : 'no'} | ${c.gate ? 'GATE' : '-'} |\n`;
    }
    const gateViolations = metricComparisons.filter(c => c.gate && c.regression);
    if (gateViolations.length > 0) {
      metricsSection += `\n**GATE VIOLATION**: ${gateViolations.length} gate fixture(s) regressed. This MUST be addressed — gate regressions block merge.\n`;
    }
  } else {
    // Fallback to raw before/after if no tracked metrics configured
    const beforeMetrics = getMetricsByExperimentAndPhase(db, exp.id, 'before');
    const afterMetrics = getMetricsByExperimentAndPhase(db, exp.id, 'after');
    if (beforeMetrics.length > 0 || afterMetrics.length > 0) {
      metricsSection = '\n\n## Framework-Captured Metrics (GROUND TRUTH — not self-reported by builder)\n';
      if (beforeMetrics.length > 0) {
        metricsSection += '### Before Build\n';
        for (const m of beforeMetrics) {
          metricsSection += `- ${m.fixture} / ${m.metric_name}: ${m.metric_value}\n`;
        }
      }
      if (afterMetrics.length > 0) {
        metricsSection += '### After Build\n';
        for (const m of afterMetrics) {
          metricsSection += `- ${m.fixture} / ${m.metric_name}: ${m.metric_value}\n`;
        }
      }
    }
  }

  // Build explicit DOUBT-{id} reference table for doubt ID threading
  let doubtReference = '';
  if (doubts.length > 0) {
    doubtReference = '\n\n## Doubt Reference (use these IDs in doubt_resolutions)\n';
    for (const d of doubts) {
      doubtReference += `- DOUBT-${d.id}: [${d.severity}] ${d.claim_doubted}\n`;
    }
    doubtReference += '\nWhen resolving doubts, use the DOUBT-{id} number as the doubt_id value in your doubt_resolutions output.';
  }

  updateExperimentStatus(db, exp.id, 'verifying');

  // Load experiment-scoped context for verifier (Tradition 13: Ijtihad)
  const verifierSupplementaryContext = loadExperimentContext(exp, root);

  // Fix #1: Experiment lineage — Tradition 1 (Hafiz), Tradition 14 (Shura)
  const verifierLineage = exportExperimentLineage(db, exp.sub_type);
  let verifierTaskPrompt =
    `Verify experiment ${exp.slug}: ${exp.hypothesis}. Check provenance and content. ` +
    `Test the ${doubts.length} doubt(s) and any adversarial challenges.` +
    metricsSection + doubtReference;
  if (verifierLineage) {
    verifierTaskPrompt += '\n\n' + verifierLineage;
  }

  // Fix #4: Provenance warning — if builder used tier 3 extraction, warn verifier
  const builderGuidanceForVerifier = getBuilderGuidance(db, exp.id);
  if (builderGuidanceForVerifier?.includes('[PROVENANCE WARNING]')) {
    verifierTaskPrompt += '\n\nNote: The builder\'s structured output was reconstructed by a secondary model (tier 3). Treat reported decisions with additional scrutiny.';
  }

  const result = await spawnAgent('verifier', {
    experiment: {
      id: exp.id,
      slug: exp.slug,
      hypothesis: exp.hypothesis,
      status: 'verifying',
      sub_type: exp.sub_type,
      builder_guidance: null,
    },
    doubts,
    challenges,
    metricComparisons: metricComparisons.length > 0 ? metricComparisons : undefined,
    supplementaryContext: verifierSupplementaryContext || undefined,
    experimentLineage: verifierLineage || undefined,
    taskPrompt: verifierTaskPrompt,
  }, root);

  ingestStructuredOutput(db, exp.id, result.structured);

  if (result.truncated && !result.structured) {
    fmt.warn(`Verifier was truncated without structured output. Experiment stays at 'verifying'.`);
    return;
  }

  // Process doubt resolutions from verifier output — with ID validation
  if (result.structured?.doubt_resolutions) {
    const knownDoubtIds = new Set(doubts.map(d => d.id));
    for (let i = 0; i < result.structured.doubt_resolutions.length; i++) {
      const dr = result.structured.doubt_resolutions[i];
      if (!dr.resolution) continue;

      if (dr.doubt_id && knownDoubtIds.has(dr.doubt_id)) {
        updateDoubtResolution(db, dr.doubt_id, dr.resolution);
      } else if (doubts[i]) {
        // Ordinal fallback — if ID doesn't match, try positional
        fmt.warn(`Doubt resolution ID ${dr.doubt_id} not found. Using ordinal fallback → DOUBT-${doubts[i].id}.`);
        updateDoubtResolution(db, doubts[i].id, dr.resolution);
      }
    }
  }

  updateExperimentStatus(db, exp.id, 'verified');
  fmt.success(`Verification complete for ${exp.slug}. Run \`majlis resolve\` next.`);
}

async function doCompress(db: ReturnType<typeof getDb>, root: string): Promise<void> {
  const synthesisPath = path.join(root, 'docs', 'synthesis', 'current.md');
  const sizeBefore = fs.existsSync(synthesisPath)
    ? fs.statSync(synthesisPath).size
    : 0;

  const sessionCount = getSessionsSinceCompression(db);

  // Export structured data from DB — the compressor's canonical source of truth
  const dbExport = exportForCompressor(db);

  const result = await spawnAgent('compressor', {
    taskPrompt:
      '## Structured Data (CANONICAL — from SQLite database)\n' +
      'The database export below is the source of truth. docs/ files are agent artifacts that may contain ' +
      'stale or incorrect information. Cross-reference everything against this data.\n\n' +
      dbExport + '\n\n' +
      '## Your Task\n' +
      'Read ALL experiments, decisions, doubts, challenges, verification reports, reframes, and recent diffs. ' +
      'Cross-reference for contradictions, redundancies, and patterns. ' +
      'REWRITE docs/synthesis/current.md — shorter and denser. ' +
      'Update docs/synthesis/fragility.md with current weak areas. ' +
      'Update docs/synthesis/dead-ends.md with structural constraints from rejected experiments.',
  }, root);

  const sizeAfter = fs.existsSync(synthesisPath)
    ? fs.statSync(synthesisPath).size
    : 0;

  recordCompression(db, sessionCount, sizeBefore, sizeAfter);

  autoCommit(root, 'compress: update synthesis');
  fmt.success(`Compression complete. Synthesis: ${sizeBefore}B → ${sizeAfter}B`);
}

/**
 * Auto-commit builder's changes on the experiment branch.
 * Excludes .majlis/ (framework DB) from the commit.
 * Failures are non-fatal — the build still succeeds.
 */
function gitCommitBuild(exp: Experiment, cwd: string): void {
  try {
    // Stage everything except the framework DB
    execSync('git add -A -- ":!.majlis/"', { cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
    // Check if there's anything staged
    const diff = execSync('git diff --cached --stat', { cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    if (!diff) {
      fmt.info('No code changes to commit.');
      return;
    }
    const msg = `EXP-${String(exp.id).padStart(3, '0')}: ${exp.slug}\n\n${exp.hypothesis ?? ''}`;
    execFileSync('git', ['commit', '-m', msg], { cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
    fmt.info(`Committed builder changes on ${exp.branch}.`);
  } catch {
    fmt.warn('Could not auto-commit builder changes — commit manually before resolving.');
  }
}

/**
 * Load experiment-scoped context files.
 * Tradition 13 (Ijtihad): the mujtahid must have mastery of relevant sources.
 * Returns concatenated content with file headers, or empty string if none.
 */
function loadExperimentContext(exp: Experiment, root: string): string {
  if (!exp.context_files) return '';
  let files: string[];
  try {
    files = JSON.parse(exp.context_files);
  } catch {
    return '';
  }
  if (!Array.isArray(files) || files.length === 0) return '';

  const sections: string[] = ['## Experiment-Scoped Reference Material'];
  for (const relPath of files) {
    const absPath = path.join(root, relPath);
    try {
      const content = fs.readFileSync(absPath, 'utf-8');
      sections.push(`### ${relPath}\n\`\`\`\n${content.slice(0, 8000)}\n\`\`\``);
    } catch {
      sections.push(`### ${relPath}\n*(file not found)*`);
    }
  }
  return sections.join('\n\n');
}

/**
 * Relative path to an experiment's doc file: docs/experiments/{NNN}-{slug}.md
 */
export function expDocRelPath(exp: Experiment): string {
  return `docs/experiments/${String(exp.id).padStart(3, '0')}-${exp.slug}.md`;
}

function resolveExperimentArg(db: ReturnType<typeof getDb>, args: string[]): Experiment {
  const slugArg = args.filter(a => !a.startsWith('--'))[0];
  let exp;
  if (slugArg) {
    exp = getExperimentBySlug(db, slugArg);
    if (!exp) throw new Error(`Experiment not found: ${slugArg}`);
  } else {
    exp = getLatestExperiment(db);
    if (!exp) throw new Error('No active experiments. Run `majlis new "hypothesis"` first.');
  }
  return exp;
}

/**
 * Ingest structured output from an agent into the database.
 */
function ingestStructuredOutput(
  db: ReturnType<typeof getDb>,
  experimentId: number,
  structured: StructuredOutput | null,
): void {
  if (!structured) return;

  db.transaction(() => {
    if (structured.decisions) {
      for (const d of structured.decisions) {
        insertDecision(db, experimentId, d.description, d.evidence_level, d.justification);
      }
      fmt.info(`Ingested ${structured.decisions.length} decision(s)`);
    }

    if (structured.grades) {
      for (const g of structured.grades) {
        insertVerification(
          db, experimentId, g.component, g.grade,
          g.provenance_intact ?? null,
          g.content_correct ?? null,
          g.notes ?? null,
        );
      }
      fmt.info(`Ingested ${structured.grades.length} verification grade(s)`);
    }

    if (structured.doubts) {
      for (const d of structured.doubts) {
        insertDoubt(
          db, experimentId,
          d.claim_doubted, d.evidence_level_of_claim,
          d.evidence_for_doubt, d.severity,
        );
      }
      fmt.info(`Ingested ${structured.doubts.length} doubt(s)`);
    }

    if (structured.challenges) {
      for (const c of structured.challenges) {
        insertChallenge(db, experimentId, c.description, c.reasoning);
      }
      fmt.info(`Ingested ${structured.challenges.length} challenge(s)`);
    }

    if (structured.reframe) {
      insertReframe(
        db, experimentId,
        structured.reframe.decomposition,
        JSON.stringify(structured.reframe.divergences),
        structured.reframe.recommendation,
      );
      fmt.info(`Ingested reframe`);
    }

    if (structured.findings) {
      for (const f of structured.findings) {
        insertFinding(db, experimentId, f.approach, f.source, f.relevance, f.contradicts_current);
      }
      fmt.info(`Ingested ${structured.findings.length} finding(s)`);
    }
  })();
}

