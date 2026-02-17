import * as fs from 'node:fs';
import * as path from 'node:path';
import { openDbAt } from '../db/connection.js';
import {
  createExperiment,
  getExperimentBySlug,
  updateExperimentStatus,
  insertDeadEnd,
  hasDoubts as dbHasDoubts,
  hasChallenges,
} from '../db/queries.js';
import { validNext, determineNextStep, isTerminal } from '../state/machine.js';
import { ExperimentStatus } from '../state/types.js';
import { runStep } from '../commands/cycle.js';
import { resolveDbOnly } from '../resolve.js';
import { isShutdownRequested } from '../shutdown.js';
import type { WorktreeInfo, SwarmExperimentResult } from './types.js';
import type { Experiment } from '../types.js';
import type { Grade } from '../state/types.js';
import * as fmt from '../output/format.js';

const MAX_STEPS = 20;

/**
 * Run a full experiment lifecycle inside a git worktree.
 * Mirrors runAutoLoop() from next.ts but uses explicit db/root.
 * Git merge/revert is deferred — uses resolveDbOnly().
 */
export async function runExperimentInWorktree(
  wt: WorktreeInfo,
): Promise<SwarmExperimentResult> {
  const label = `[swarm:${wt.paddedNum}]`;
  let db;
  let exp: Experiment | null = null;
  let overallGrade: Grade | null = null;
  let stepCount = 0;

  try {
    db = openDbAt(wt.path);

    // Create experiment in worktree DB — start at 'reframed' (skip classify/reframe)
    exp = createExperiment(db, wt.slug, wt.branch, wt.hypothesis, null, null);
    updateExperimentStatus(db, exp.id, 'reframed');
    exp.status = 'reframed';

    // Create experiment log from template
    const templatePath = path.join(wt.path, 'docs', 'experiments', '_TEMPLATE.md');
    if (fs.existsSync(templatePath)) {
      const template = fs.readFileSync(templatePath, 'utf-8');
      const logContent = template
        .replace(/\{\{title\}\}/g, wt.hypothesis)
        .replace(/\{\{hypothesis\}\}/g, wt.hypothesis)
        .replace(/\{\{branch\}\}/g, wt.branch)
        .replace(/\{\{status\}\}/g, 'classified')
        .replace(/\{\{sub_type\}\}/g, 'unclassified')
        .replace(/\{\{date\}\}/g, new Date().toISOString().split('T')[0]);
      const logPath = path.join(wt.path, 'docs', 'experiments', `${wt.paddedNum}-${wt.slug}.md`);
      fs.writeFileSync(logPath, logContent);
    }

    fmt.info(`${label} Starting: ${wt.hypothesis}`);

    while (stepCount < MAX_STEPS) {
      if (isShutdownRequested()) {
        fmt.warn(`${label} Shutdown requested. Stopping.`);
        break;
      }

      stepCount++;

      // Refresh experiment state
      const fresh = getExperimentBySlug(db, wt.slug);
      if (!fresh) break;
      exp = fresh;

      if (isTerminal(exp.status as ExperimentStatus)) {
        fmt.success(`${label} Reached terminal: ${exp.status}`);
        break;
      }

      const valid = validNext(exp.status as ExperimentStatus);
      if (valid.length === 0) break;

      const nextStep = determineNextStep(
        exp, valid,
        dbHasDoubts(db, exp.id),
        hasChallenges(db, exp.id),
      );

      fmt.info(`${label} [${stepCount}/${MAX_STEPS}] ${exp.status} -> ${nextStep}`);

      // Handle resolve specially — use resolveDbOnly (no git operations)
      if (nextStep === ExperimentStatus.RESOLVED) {
        overallGrade = await resolveDbOnly(db, exp, wt.path);
        continue;
      }

      // Handle compressed → merged transition
      if (nextStep === ExperimentStatus.COMPRESSED) {
        await runStep('compress', db, exp, wt.path);
        updateExperimentStatus(db, exp.id, 'compressed');
        continue;
      }

      if (nextStep === ExperimentStatus.MERGED) {
        updateExperimentStatus(db, exp.id, 'merged');
        fmt.success(`${label} Merged.`);
        break;
      }

      if (nextStep === ExperimentStatus.REFRAMED) {
        updateExperimentStatus(db, exp.id, 'reframed');
        continue;
      }

      // Map ExperimentStatus to cycle step name
      const stepName = statusToStepName(nextStep);
      if (!stepName) {
        fmt.warn(`${label} Unknown step: ${nextStep}`);
        break;
      }

      try {
        await runStep(stepName, db, exp, wt.path);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        fmt.warn(`${label} Step failed: ${message}`);
        try {
          insertDeadEnd(db, exp.id, exp.hypothesis ?? exp.slug, message,
            `Process failure: ${message}`, exp.sub_type, 'procedural');
          updateExperimentStatus(db, exp.id, 'dead_end');
        } catch { /* best effort */ }
        break;
      }
    }

    if (stepCount >= MAX_STEPS) {
      fmt.warn(`${label} Hit max steps (${MAX_STEPS}).`);
    }

    // Refresh final state
    const finalExp = getExperimentBySlug(db, wt.slug);
    if (finalExp) exp = finalExp;

    const finalStatus = exp?.status ?? 'error';
    return {
      worktree: wt,
      experiment: exp,
      finalStatus,
      overallGrade,
      costUsd: 0, // TODO: track via SDK when available
      stepCount,
    };

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    fmt.warn(`${label} Fatal error: ${message}`);
    return {
      worktree: wt,
      experiment: exp,
      finalStatus: 'error',
      overallGrade: null,
      costUsd: 0,
      stepCount,
      error: message,
    };
  } finally {
    if (db) {
      try { db.close(); } catch { /* ignore */ }
    }
  }
}

/**
 * Map ExperimentStatus enum values to cycle step names.
 */
function statusToStepName(status: ExperimentStatus): string | null {
  switch (status) {
    case ExperimentStatus.GATED: return 'gate';
    case ExperimentStatus.BUILDING: return 'build';
    case ExperimentStatus.CHALLENGED: return 'challenge';
    case ExperimentStatus.DOUBTED: return 'doubt';
    case ExperimentStatus.SCOUTED: return 'scout';
    case ExperimentStatus.VERIFYING: return 'verify';
    default: return null;
  }
}
