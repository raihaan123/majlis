import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
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
} from '../db/queries.js';
import { transition } from '../state/machine.js';
import { ExperimentStatus } from '../state/types.js';
import { spawnAgent, spawnRecovery } from '../agents/spawn.js';
import { resolve as resolveExperiment } from '../resolve.js';
import type { Experiment, Doubt } from '../types.js';
import type { StructuredOutput } from '../agents/types.js';
import { loadConfig, readFileOrEmpty, truncateContext, CONTEXT_LIMITS } from '../config.js';
import { parseMetricsOutput } from '../metrics.js';
import * as fmt from '../output/format.js';

export async function cycle(step: string, args: string[]): Promise<void> {
  const root = findProjectRoot();
  if (!root) throw new Error('Not in a Majlis project. Run `majlis init` first.');

  const db = getDb(root);
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
    case 'compress':
      return doCompress(db, root);
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
      'Check: (a) stale references — does the hypothesis reference specific lines, functions, or structures that may not exist? ' +
      '(b) dead-end overlap — does this hypothesis repeat an approach already ruled out by structural dead-ends? ' +
      '(c) scope — is this a single focused change, or does it try to do multiple things?\n\n' +
      'Output your gate_decision as "approve", "reject", or "flag" with reasoning.',
  }, root);

  ingestStructuredOutput(db, exp.id, result.structured);

  const decision = result.structured?.gate_decision ?? 'approve';
  const reason = result.structured?.reason ?? '';

  if (decision === 'reject') {
    updateExperimentStatus(db, exp.id, 'gated');
    fmt.warn(`Gate REJECTED for ${exp.slug}: ${reason}`);
    fmt.warn(`Revise the hypothesis or run \`majlis revert\` to abandon.`);
  } else {
    if (decision === 'flag') {
      fmt.warn(`Gate flagged concerns for ${exp.slug}: ${reason}`);
    }
    updateExperimentStatus(db, exp.id, 'gated');
    fmt.success(`Gate passed for ${exp.slug}. Run \`majlis build\` next.`);
  }
}

async function doBuild(db: ReturnType<typeof getDb>, exp: Experiment, root: string): Promise<void> {
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

  taskPrompt += '\n\nNote: The framework captures metrics automatically. Do NOT claim specific numbers unless quoting framework output.';

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
    taskPrompt,
  }, root);

  // Ingest structured output
  ingestStructuredOutput(db, exp.id, result.structured);

  if (result.truncated && !result.structured) {
    // Builder hit max turns without producing structured output.
    // Run recovery agent to clean up the experiment doc, then stay at 'building'.
    fmt.warn(`Builder was truncated (hit max turns) without producing structured output.`);
    await spawnRecovery('builder', result.output, {
      experiment: { id: exp.id, slug: exp.slug, hypothesis: exp.hypothesis, status: 'building', sub_type: exp.sub_type, builder_guidance: null },
    }, root);
    fmt.warn(`Experiment stays at 'building'. Run \`majlis build\` to retry or \`majlis revert\` to abandon.`);
  } else {
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
  const paddedNum = String(exp.id).padStart(3, '0');
  const expDocPath = path.join(root, 'docs', 'experiments', `${paddedNum}-${exp.slug}.md`);
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
  const beforeMetrics = getMetricsByExperimentAndPhase(db, exp.id, 'before');
  const afterMetrics = getMetricsByExperimentAndPhase(db, exp.id, 'after');
  let metricsSection = '';
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
    taskPrompt:
      `Verify experiment ${exp.slug}: ${exp.hypothesis}. Check provenance and content. ` +
      `Test the ${doubts.length} doubt(s) and any adversarial challenges.` +
      metricsSection + doubtReference,
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
    execSync(`git commit -m ${JSON.stringify(msg)}`, { cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
    fmt.info(`Committed builder changes on ${exp.branch}.`);
  } catch {
    fmt.warn('Could not auto-commit builder changes — commit manually before resolving.');
  }
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
}

