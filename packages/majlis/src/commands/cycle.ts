import * as fs from 'node:fs';
import * as path from 'node:path';
import { getDb, findProjectRoot } from '../db/connection.js';
import {
  getExperimentBySlug,
  getLatestExperiment,
  updateExperimentStatus,
  getDoubtsByExperiment,
  getVerificationsByExperiment,
  getSessionsSinceCompression,
  recordCompression,
  listAllDeadEnds,
  listDeadEndsBySubType,
  getBuilderGuidance,
} from '../db/queries.js';
import { transition } from '../state/machine.js';
import { ExperimentStatus } from '../state/types.js';
import { spawnAgent } from '../agents/spawn.js';
import { resolve as resolveExperiment } from '../resolve.js';
import type { Experiment } from '../types.js';
import type { StructuredOutput } from '../agents/types.js';
import {
  insertDecision,
  insertDoubt,
  insertChallenge,
  insertVerification,
  updateDoubtResolution,
} from '../db/queries.js';
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

  await resolveExperiment(db, exp, root);
  updateExperimentStatus(db, exp.id, 'resolved');
}

async function doBuild(db: ReturnType<typeof getDb>, exp: Experiment, root: string): Promise<void> {
  // Validate transition
  transition(exp.status as ExperimentStatus, ExperimentStatus.BUILDING);

  // Gather context
  const deadEnds = exp.sub_type ? listDeadEndsBySubType(db, exp.sub_type) : listAllDeadEnds(db);
  const builderGuidance = getBuilderGuidance(db, exp.id);

  const fragilityPath = path.join(root, 'docs', 'synthesis', 'fragility.md');
  const fragility = fs.existsSync(fragilityPath) ? fs.readFileSync(fragilityPath, 'utf-8') : '';

  const synthesisPath = path.join(root, 'docs', 'synthesis', 'current.md');
  const synthesis = fs.existsSync(synthesisPath) ? fs.readFileSync(synthesisPath, 'utf-8') : '';

  updateExperimentStatus(db, exp.id, 'building');

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
    taskPrompt: builderGuidance
      ? `Previous attempt was weak. Here is guidance for this attempt:\n${builderGuidance}\n\nBuild the experiment: ${exp.hypothesis}`
      : `Build the experiment: ${exp.hypothesis}`,
  }, root);

  // Ingest structured output
  ingestStructuredOutput(db, exp.id, result.structured);

  updateExperimentStatus(db, exp.id, 'built');
  fmt.success(`Build complete for ${exp.slug}. Run \`majlis doubt\` or \`majlis challenge\` next.`);
}

async function doChallenge(db: ReturnType<typeof getDb>, exp: Experiment, root: string): Promise<void> {
  transition(exp.status as ExperimentStatus, ExperimentStatus.CHALLENGED);

  const result = await spawnAgent('adversary', {
    experiment: {
      id: exp.id,
      slug: exp.slug,
      hypothesis: exp.hypothesis,
      status: exp.status,
      sub_type: exp.sub_type,
      builder_guidance: null,
    },
    taskPrompt: `Construct adversarial test cases for experiment ${exp.slug}: ${exp.hypothesis}`,
  }, root);

  ingestStructuredOutput(db, exp.id, result.structured);
  updateExperimentStatus(db, exp.id, 'challenged');
  fmt.success(`Challenge complete for ${exp.slug}. Run \`majlis doubt\` or \`majlis verify\` next.`);
}

async function doDoubt(db: ReturnType<typeof getDb>, exp: Experiment, root: string): Promise<void> {
  transition(exp.status as ExperimentStatus, ExperimentStatus.DOUBTED);

  const result = await spawnAgent('critic', {
    experiment: {
      id: exp.id,
      slug: exp.slug,
      hypothesis: exp.hypothesis,
      status: exp.status,
      sub_type: exp.sub_type,
      builder_guidance: null, // Critic does NOT see builder reasoning
    },
    taskPrompt: `Doubt the work in experiment ${exp.slug}: ${exp.hypothesis}. Produce a doubt document with evidence for each doubt.`,
  }, root);

  ingestStructuredOutput(db, exp.id, result.structured);
  updateExperimentStatus(db, exp.id, 'doubted');
  fmt.success(`Doubt pass complete for ${exp.slug}. Run \`majlis challenge\` or \`majlis verify\` next.`);
}

async function doScout(db: ReturnType<typeof getDb>, exp: Experiment, root: string): Promise<void> {
  transition(exp.status as ExperimentStatus, ExperimentStatus.SCOUTED);

  const synthesisPath = path.join(root, 'docs', 'synthesis', 'current.md');
  const synthesis = fs.existsSync(synthesisPath) ? fs.readFileSync(synthesisPath, 'utf-8') : '';

  updateExperimentStatus(db, exp.id, 'scouted');

  const result = await spawnAgent('scout', {
    experiment: {
      id: exp.id,
      slug: exp.slug,
      hypothesis: exp.hypothesis,
      status: 'scouted',
      sub_type: exp.sub_type,
      builder_guidance: null,
    },
    synthesis,
    taskPrompt: `Search for alternative approaches to the problem in experiment ${exp.slug}: ${exp.hypothesis}. Look for contradictory approaches, solutions from other fields, and known limitations of the current approach.`,
  }, root);

  ingestStructuredOutput(db, exp.id, result.structured);
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
    taskPrompt: `Verify experiment ${exp.slug}: ${exp.hypothesis}. Check provenance and content. Test the ${doubts.length} doubt(s) and any adversarial challenges.`,
  }, root);

  ingestStructuredOutput(db, exp.id, result.structured);

  // Process doubt resolutions from verifier output
  if (result.structured?.doubt_resolutions) {
    for (const dr of result.structured.doubt_resolutions) {
      if (dr.doubt_id && dr.resolution) {
        updateDoubtResolution(db, dr.doubt_id, dr.resolution);
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

  const result = await spawnAgent('compressor', {
    taskPrompt:
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
}
