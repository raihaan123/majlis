import * as fs from 'node:fs';
import * as path from 'node:path';
import type Database from 'better-sqlite3';
import type { Experiment, Verification } from './types.js';
import type { Grade } from './state/types.js';
import { GRADE_ORDER } from './state/types.js';
import {
  getVerificationsByExperiment,
  getConfirmedDoubts,
  updateExperimentStatus,
  storeBuilderGuidance,
  incrementSubTypeFailure,
  insertDeadEnd,
  insertVerification,
} from './db/queries.js';
import { spawnSynthesiser } from './agents/spawn.js';
import { execSync } from 'node:child_process';
import * as fmt from './output/format.js';

/**
 * Determine the worst grade from a set of verifications.
 * Deterministic: rejected > weak > good > sound.
 * PRD v2 §4.5.
 */
export function worstGrade(grades: Verification[]): Grade {
  for (const grade of GRADE_ORDER) {
    if (grades.some(g => g.grade === grade)) return grade;
  }
  return 'sound'; // no grades = vacuously sound
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

  switch (overallGrade) {
    case 'sound': {
      // All components proven. Safe to merge.
      gitMerge(exp.branch, projectRoot);
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

      const guidanceText = guidance.structured?.guidance ?? guidance.output;
      db.transaction(() => {
        storeBuilderGuidance(db, exp.id, guidanceText);
        updateExperimentStatus(db, exp.id, 'building');
        if (exp.sub_type) {
          incrementSubTypeFailure(db, exp.sub_type, exp.id, 'weak');
        }
      })();
      fmt.warn(`Experiment ${exp.slug} CYCLING BACK (weak). Guidance generated for builder.`);
      break;
    }

    case 'rejected': {
      // Demonstrably broken. Dead-end it. Revert the branch.
      gitRevert(exp.branch, projectRoot);
      const rejectedComponents = grades.filter(g => g.grade === 'rejected');
      const whyFailed = rejectedComponents.map(r => r.notes ?? 'rejected').join('; ');

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

  switch (overallGrade) {
    case 'sound':
      updateExperimentStatus(db, exp.id, 'merged');
      fmt.success(`Experiment ${exp.slug} RESOLVED (sound) — git merge deferred.`);
      break;

    case 'good': {
      const gaps = grades
        .filter(g => g.grade === 'good')
        .map(g => `- **${g.component}**: ${g.notes ?? 'minor gaps'}`)
        .join('\n');
      appendToFragilityMap(projectRoot, exp.slug, gaps);
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

      const guidanceText = guidance.structured?.guidance ?? guidance.output;
      db.transaction(() => {
        storeBuilderGuidance(db, exp.id, guidanceText);
        updateExperimentStatus(db, exp.id, 'building');
        if (exp.sub_type) {
          incrementSubTypeFailure(db, exp.sub_type, exp.id, 'weak');
        }
      })();
      fmt.warn(`Experiment ${exp.slug} CYCLING BACK (weak). Guidance generated.`);
      break;
    }

    case 'rejected': {
      const rejectedComponents = grades.filter(g => g.grade === 'rejected');
      const whyFailed = rejectedComponents.map(r => r.notes ?? 'rejected').join('; ');
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
    execSync(`git merge ${branch} --no-ff -m "Merge experiment branch ${branch}"`, {
      cwd,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (err) {
    console.warn(`[majlis] Git merge of ${branch} failed — you may need to merge manually.`);
  }
}

function gitRevert(branch: string, cwd: string): void {
  try {
    // Don't delete the branch — just switch away from it.
    // Also discard uncommitted experiment changes so they don't
    // follow us back to main (e.g. if auto-commit failed).
    const currentBranch = execSync('git rev-parse --abbrev-ref HEAD', {
      cwd,
      encoding: 'utf-8',
    }).trim();

    if (currentBranch === branch) {
      // Discard tracked modifications from the experiment
      try {
        execSync('git checkout -- .', { cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
      } catch { /* no uncommitted changes — fine */ }
      execSync('git checkout main 2>/dev/null || git checkout master', {
        cwd,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    }
  } catch {
    console.warn(`[majlis] Could not switch away from ${branch} — you may need to do this manually.`);
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
