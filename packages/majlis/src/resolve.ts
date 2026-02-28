import * as fs from 'node:fs';
import * as path from 'node:path';
import type Database from 'better-sqlite3';
import type { Experiment, Verification, MajlisConfig } from './types.js';
import type { Grade } from './state/types.js';
import { ExperimentStatus, GRADE_ORDER } from './state/types.js';
import { transition } from './state/machine.js';
import {
  getVerificationsByExperiment,
  getConfirmedDoubts,
  updateExperimentStatus,
  storeBuilderGuidance,
  incrementSubTypeFailure,
  insertDeadEnd,
  insertVerification,
} from './db/queries.js';
import { compareMetrics, checkGateViolations } from './metrics.js';
import { loadConfig } from './config.js';
import { spawnSynthesiser } from './agents/spawn.js';
import { execSync, execFileSync } from 'node:child_process';
import { autoCommit } from './git.js';
import * as fmt from './output/format.js';

/** Max chars for accumulated guidance. Oldest iterations truncated first. */
const GUIDANCE_MAX_CHARS = 12_000;

/**
 * Accumulate guidance across iterations instead of overwriting.
 * Each iteration gets a header; oldest iterations are truncated first
 * to stay within GUIDANCE_MAX_CHARS.
 */
export function accumulateGuidance(existing: string | null, newGuidance: string): string {
  // Find the highest existing iteration number (survives truncation)
  const iterationNums = existing?.match(/### Iteration (\d+)/g)
    ?.map(m => parseInt(m.replace('### Iteration ', ''), 10)) ?? [];
  const maxExisting = iterationNums.length > 0 ? Math.max(...iterationNums) : 0;
  const iterationNum = maxExisting + 1;

  const header = `### Iteration ${iterationNum} (latest)`;
  const newBlock = `${header}\n${newGuidance}`;

  if (!existing) return newBlock;

  // Strip "(latest)" from previous iteration headers
  const cleaned = existing.replace(/ \(latest\)/g, '');
  const accumulated = `${newBlock}\n\n---\n\n${cleaned}`;

  // Truncate oldest iterations if over limit
  if (accumulated.length <= GUIDANCE_MAX_CHARS) return accumulated;

  // Split by iteration headers, drop oldest iterations until under limit
  const sections = accumulated.split(/(?=^### Iteration \d+)/m);
  let result = '';
  for (const section of sections) {
    if (result.length + section.length > GUIDANCE_MAX_CHARS && result.length > 0) {
      result += '\n\n[Earlier iterations truncated]';
      break;
    }
    result += section;
  }
  return result;
}

/**
 * Extract [DEAD-APPROACH] markers from synthesiser output.
 * Format: [DEAD-APPROACH] approach name: why it cannot work
 */
export function parseSynthesiserDeadApproaches(output: string): Array<{ approach: string; reason: string }> {
  const results: Array<{ approach: string; reason: string }> = [];
  const regex = /\[DEAD-APPROACH\]\s*(.+?):\s*(.+)/g;
  let match;
  while ((match = regex.exec(output)) !== null) {
    results.push({ approach: match[1].trim(), reason: match[2].trim() });
  }
  return results;
}

/**
 * Determine the worst grade from a set of verifications.
 * Deterministic: rejected > weak > good > sound.
 * PRD v2 §4.5.
 */
export function worstGrade(grades: Verification[]): Grade {
  if (grades.length === 0) {
    throw new Error('Cannot determine grade from empty verification set — this indicates a data integrity issue');
  }
  for (const grade of GRADE_ORDER) {
    if (grades.some(g => g.grade === grade)) return grade;
  }
  return 'sound';
}

/**
 * Resolution logic — the most important handoff in the cycle.
 * PRD v2 §4.5 exactly.
 */
export async function resolve(
  db: Database.Database,
  exp: Experiment,
  projectRoot: string,
): Promise<void> {
  let grades = getVerificationsByExperiment(db, exp.id);

  if (grades.length === 0) {
    fmt.warn(`No verification records for ${exp.slug}. Defaulting to weak.`);
    insertVerification(db, exp.id, 'auto-default', 'weak', null, null,
      'No structured verification output. Auto-defaulted to weak.');
    grades = getVerificationsByExperiment(db, exp.id);
  }

  const overallGrade = worstGrade(grades);

  // Gate violation check — a single regression on a gate fixture blocks merge
  // regardless of verification grades. Tradition 3 (Hadith): one weak link
  // invalidates the chain. Tradition 10 (Maqasid): gate fixtures are daruriyyat.
  const config = loadConfig(projectRoot);
  const metricComparisons = compareMetrics(db, exp.id, config);
  const gateViolations = checkGateViolations(metricComparisons);

  if (gateViolations.length > 0 && (overallGrade === 'sound' || overallGrade === 'good')) {
    fmt.warn('Gate fixture regression detected — blocking merge:');
    for (const v of gateViolations) {
      fmt.warn(`  ${v.fixture} / ${v.metric}: ${v.before} → ${v.after} (${v.delta > 0 ? '+' : ''}${v.delta})`);
    }
    // Downgrade to weak — cycle back with guidance about the gate violation
    updateExperimentStatus(db, exp.id, 'resolved');
    const gateGuidance = `Gate fixture regression blocks merge. Fix these regressions before re-attempting:\n` +
      gateViolations.map(v => `- ${v.fixture} / ${v.metric}: was ${v.before}, now ${v.after}`).join('\n');
    const accumulatedGate = accumulateGuidance(exp.builder_guidance, gateGuidance);
    transition(ExperimentStatus.RESOLVED, ExperimentStatus.BUILDING);
    db.transaction(() => {
      storeBuilderGuidance(db, exp.id, accumulatedGate);
      updateExperimentStatus(db, exp.id, 'building');
      if (exp.sub_type) {
        incrementSubTypeFailure(db, exp.sub_type, exp.id, 'weak');
      }
    })();
    fmt.warn(`Experiment ${exp.slug} CYCLING BACK — gate fixture(s) regressed.`);
    return;
  }

  // Mark as resolved first — all cases below hop from RESOLVED to a final state
  updateExperimentStatus(db, exp.id, 'resolved');

  switch (overallGrade) {
    case 'sound': {
      // All components proven. Safe to merge.
      gitMerge(exp.branch, projectRoot);
      transition(ExperimentStatus.RESOLVED, ExperimentStatus.MERGED);
      updateExperimentStatus(db, exp.id, 'merged');
      fmt.success(`Experiment ${exp.slug} MERGED (all sound).`);
      break;
    }

    case 'good': {
      // Works but has gaps. Merge and record gaps in fragility map.
      gitMerge(exp.branch, projectRoot);
      const gaps = grades
        .filter(g => g.grade === 'good')
        .map(g => `- **${g.component}**: ${g.notes ?? 'minor gaps'}`)
        .join('\n');
      appendToFragilityMap(projectRoot, exp.slug, gaps);
      autoCommit(projectRoot, `resolve: fragility gaps from ${exp.slug}`);
      transition(ExperimentStatus.RESOLVED, ExperimentStatus.MERGED);
      updateExperimentStatus(db, exp.id, 'merged');
      fmt.success(`Experiment ${exp.slug} MERGED (good, ${grades.filter(g => g.grade === 'good').length} gaps added to fragility map).`);
      break;
    }

    case 'weak': {
      // Needs another build cycle. LLM synthesises guidance for the builder.
      const confirmedDoubts = getConfirmedDoubts(db, exp.id);

      const guidance = await spawnSynthesiser({
        experiment: {
          id: exp.id,
          slug: exp.slug,
          hypothesis: exp.hypothesis,
          status: exp.status,
          sub_type: exp.sub_type,
          builder_guidance: exp.builder_guidance,
        },
        verificationReport: grades,
        confirmedDoubts,
        taskPrompt:
          'Synthesise the verification report, confirmed doubts, and adversarial ' +
          'case results into specific, actionable guidance for the builder\'s next attempt. ' +
          'Be concrete: which specific decisions need revisiting, which assumptions broke, ' +
          'and what constraints must the next approach satisfy.',
      }, projectRoot);

      const rawGuidance = guidance.structured?.guidance ?? guidance.output;

      // Accumulate guidance across iterations instead of overwriting
      const accumulated = accumulateGuidance(exp.builder_guidance, rawGuidance);

      transition(ExperimentStatus.RESOLVED, ExperimentStatus.BUILDING);
      db.transaction(() => {
        storeBuilderGuidance(db, exp.id, accumulated);
        updateExperimentStatus(db, exp.id, 'building');
        if (exp.sub_type) {
          incrementSubTypeFailure(db, exp.sub_type, exp.id, 'weak');
        }

        // Register component-level dead-ends from rejected verifier grades
        const rejectedInWeak = grades.filter(g => g.grade === 'rejected');
        for (const rc of rejectedInWeak) {
          insertDeadEnd(db, exp.id,
            `${rc.component} (iteration within ${exp.slug})`,
            rc.notes ?? 'rejected by verifier',
            `Component ${rc.component} rejected: ${rc.notes ?? 'approach does not work'}`,
            exp.sub_type, 'structural');
        }
        if (rejectedInWeak.length > 0) {
          fmt.info(`Registered ${rejectedInWeak.length} component-level dead-end(s) from weak verification.`);
        }

        // Register approach-level dead-ends from synthesiser [DEAD-APPROACH] markers
        const deadApproaches = parseSynthesiserDeadApproaches(guidance.output);
        for (const da of deadApproaches) {
          insertDeadEnd(db, exp.id, da.approach, da.reason,
            da.reason, exp.sub_type, 'structural');
        }
        if (deadApproaches.length > 0) {
          fmt.info(`Registered ${deadApproaches.length} dead approach(es) from synthesiser.`);
        }
      })();
      fmt.warn(`Experiment ${exp.slug} CYCLING BACK (weak). Guidance accumulated for builder.`);
      break;
    }

    case 'rejected': {
      // Demonstrably broken. Dead-end it. Revert the branch.
      gitRevert(exp.branch, projectRoot);
      const rejectedComponents = grades.filter(g => g.grade === 'rejected');
      const whyFailed = rejectedComponents.map(r => r.notes ?? 'rejected').join('; ');

      transition(ExperimentStatus.RESOLVED, ExperimentStatus.DEAD_END);
      db.transaction(() => {
        insertDeadEnd(
          db,
          exp.id,
          exp.hypothesis ?? exp.slug,
          whyFailed,
          `Approach rejected: ${whyFailed}`,
          exp.sub_type,
          'structural',
        );
        updateExperimentStatus(db, exp.id, 'dead_end');
        if (exp.sub_type) {
          incrementSubTypeFailure(db, exp.sub_type, exp.id, 'rejected');
        }
      })();
      fmt.info(`Experiment ${exp.slug} DEAD-ENDED (rejected). Constraint recorded.`);
      break;
    }
  }
}

/**
 * Resolution logic without git operations — for swarm worktrees.
 * Git merge/revert is handled centrally by the swarm orchestrator.
 * Returns the overall grade so the caller can decide what to do.
 */
export async function resolveDbOnly(
  db: Database.Database,
  exp: Experiment,
  projectRoot: string,
): Promise<Grade> {
  let grades = getVerificationsByExperiment(db, exp.id);

  if (grades.length === 0) {
    fmt.warn(`No verification records for ${exp.slug}. Defaulting to weak.`);
    insertVerification(db, exp.id, 'auto-default', 'weak', null, null,
      'No structured verification output. Auto-defaulted to weak.');
    grades = getVerificationsByExperiment(db, exp.id);
  }

  const overallGrade = worstGrade(grades);

  // Gate violation check (same as resolve() — DRY would be nice but
  // resolveDbOnly is intentionally a separate path for swarm)
  const config = loadConfig(projectRoot);
  const metricComparisons = compareMetrics(db, exp.id, config);
  const gateViolations = checkGateViolations(metricComparisons);

  if (gateViolations.length > 0 && (overallGrade === 'sound' || overallGrade === 'good')) {
    fmt.warn('Gate fixture regression detected — blocking merge:');
    for (const v of gateViolations) {
      fmt.warn(`  ${v.fixture} / ${v.metric}: ${v.before} → ${v.after} (${v.delta > 0 ? '+' : ''}${v.delta})`);
    }
    updateExperimentStatus(db, exp.id, 'resolved');
    const swarmGateGuidance = `Gate fixture regression blocks merge. Fix these regressions before re-attempting:\n` +
      gateViolations.map(v => `- ${v.fixture} / ${v.metric}: was ${v.before}, now ${v.after}`).join('\n');
    const accumulatedSwarmGate = accumulateGuidance(exp.builder_guidance, swarmGateGuidance);
    transition(ExperimentStatus.RESOLVED, ExperimentStatus.BUILDING);
    db.transaction(() => {
      storeBuilderGuidance(db, exp.id, accumulatedSwarmGate);
      updateExperimentStatus(db, exp.id, 'building');
      if (exp.sub_type) {
        incrementSubTypeFailure(db, exp.sub_type, exp.id, 'weak');
      }
    })();
    fmt.warn(`Experiment ${exp.slug} CYCLING BACK — gate fixture(s) regressed.`);
    return 'weak' as Grade;
  }

  // Mark as resolved first — all cases below hop from RESOLVED to a final state
  updateExperimentStatus(db, exp.id, 'resolved');

  switch (overallGrade) {
    case 'sound':
      transition(ExperimentStatus.RESOLVED, ExperimentStatus.MERGED);
      updateExperimentStatus(db, exp.id, 'merged');
      fmt.success(`Experiment ${exp.slug} RESOLVED (sound) — git merge deferred.`);
      break;

    case 'good': {
      const gaps = grades
        .filter(g => g.grade === 'good')
        .map(g => `- **${g.component}**: ${g.notes ?? 'minor gaps'}`)
        .join('\n');
      appendToFragilityMap(projectRoot, exp.slug, gaps);
      transition(ExperimentStatus.RESOLVED, ExperimentStatus.MERGED);
      updateExperimentStatus(db, exp.id, 'merged');
      fmt.success(`Experiment ${exp.slug} RESOLVED (good) — git merge deferred.`);
      break;
    }

    case 'weak': {
      const confirmedDoubts = getConfirmedDoubts(db, exp.id);
      const guidance = await spawnSynthesiser({
        experiment: {
          id: exp.id, slug: exp.slug, hypothesis: exp.hypothesis,
          status: exp.status, sub_type: exp.sub_type, builder_guidance: exp.builder_guidance,
        },
        verificationReport: grades,
        confirmedDoubts,
        taskPrompt:
          'Synthesise the verification report, confirmed doubts, and adversarial ' +
          'case results into specific, actionable guidance for the builder\'s next attempt. ' +
          'Be concrete: which specific decisions need revisiting, which assumptions broke, ' +
          'and what constraints must the next approach satisfy.',
      }, projectRoot);

      const rawGuidance = guidance.structured?.guidance ?? guidance.output;

      // Accumulate guidance across iterations instead of overwriting
      const accumulated = accumulateGuidance(exp.builder_guidance, rawGuidance);

      transition(ExperimentStatus.RESOLVED, ExperimentStatus.BUILDING);
      db.transaction(() => {
        storeBuilderGuidance(db, exp.id, accumulated);
        updateExperimentStatus(db, exp.id, 'building');
        if (exp.sub_type) {
          incrementSubTypeFailure(db, exp.sub_type, exp.id, 'weak');
        }

        // Register component-level dead-ends from rejected verifier grades
        const rejectedInWeak = grades.filter(g => g.grade === 'rejected');
        for (const rc of rejectedInWeak) {
          insertDeadEnd(db, exp.id,
            `${rc.component} (iteration within ${exp.slug})`,
            rc.notes ?? 'rejected by verifier',
            `Component ${rc.component} rejected: ${rc.notes ?? 'approach does not work'}`,
            exp.sub_type, 'structural');
        }
        if (rejectedInWeak.length > 0) {
          fmt.info(`Registered ${rejectedInWeak.length} component-level dead-end(s) from weak verification.`);
        }

        // Register approach-level dead-ends from synthesiser [DEAD-APPROACH] markers
        const deadApproaches = parseSynthesiserDeadApproaches(guidance.output);
        for (const da of deadApproaches) {
          insertDeadEnd(db, exp.id, da.approach, da.reason,
            da.reason, exp.sub_type, 'structural');
        }
        if (deadApproaches.length > 0) {
          fmt.info(`Registered ${deadApproaches.length} dead approach(es) from synthesiser.`);
        }
      })();
      fmt.warn(`Experiment ${exp.slug} CYCLING BACK (weak). Guidance accumulated.`);
      break;
    }

    case 'rejected': {
      const rejectedComponents = grades.filter(g => g.grade === 'rejected');
      const whyFailed = rejectedComponents.map(r => r.notes ?? 'rejected').join('; ');
      transition(ExperimentStatus.RESOLVED, ExperimentStatus.DEAD_END);
      db.transaction(() => {
        insertDeadEnd(db, exp.id, exp.hypothesis ?? exp.slug, whyFailed,
          `Approach rejected: ${whyFailed}`, exp.sub_type, 'structural');
        updateExperimentStatus(db, exp.id, 'dead_end');
        if (exp.sub_type) {
          incrementSubTypeFailure(db, exp.sub_type, exp.id, 'rejected');
        }
      })();
      fmt.info(`Experiment ${exp.slug} DEAD-ENDED (rejected). Constraint recorded.`);
      break;
    }
  }

  return overallGrade;
}

function gitMerge(branch: string, cwd: string): void {
  try {
    // Must be on main/master to merge the experiment branch into it.
    // Without this, `git merge exp/foo` while on exp/foo is a no-op.
    try {
      execFileSync('git', ['checkout', 'main'], {
        cwd,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch {
      execFileSync('git', ['checkout', 'master'], {
        cwd,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    }
    execFileSync('git', ['merge', branch, '--no-ff', '-m', `Merge experiment branch ${branch}`], {
      cwd,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (err) {
    fmt.warn(`Git merge of ${branch} failed — you may need to merge manually.`);
  }
}

function gitRevert(branch: string, cwd: string): void {
  try {
    // Don't delete the branch — just switch away from it.
    // Also discard uncommitted experiment changes so they don't
    // follow us back to main (e.g. if auto-commit failed).
    const currentBranch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd,
      encoding: 'utf-8',
    }).trim();

    if (currentBranch === branch) {
      // Discard tracked modifications from the experiment
      try {
        execFileSync('git', ['checkout', '--', '.'], { cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
      } catch { /* no uncommitted changes — fine */ }
      try {
        execFileSync('git', ['checkout', 'main'], {
          cwd,
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe'],
        });
      } catch {
        execFileSync('git', ['checkout', 'master'], {
          cwd,
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe'],
        });
      }
    }
  } catch {
    fmt.warn(`Could not switch away from ${branch} — you may need to do this manually.`);
  }
}

function appendToFragilityMap(projectRoot: string, expSlug: string, gaps: string): void {
  const fragPath = path.join(projectRoot, 'docs', 'synthesis', 'fragility.md');

  let content = '';
  if (fs.existsSync(fragPath)) {
    content = fs.readFileSync(fragPath, 'utf-8');
  }

  const entry = `\n## From experiment: ${expSlug}\n${gaps}\n`;
  fs.writeFileSync(fragPath, content + entry);
}
