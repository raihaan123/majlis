import * as fs from 'node:fs';
import * as path from 'node:path';
import { getDb, findProjectRoot } from '../db/connection.js';
import {
  getLatestExperiment,
  getActiveSession,
  getDoubtsByExperiment,
  getChallengesByExperiment,
  getVerificationsByExperiment,
  getMetricsByExperimentAndPhase,
  listStructuralDeadEndsBySubType,
  listStructuralDeadEnds,
  getRecentNotes,
} from '../db/queries.js';
import { readFileOrEmpty } from '../config.js';
import * as fmt from '../output/format.js';

/** States that occur after the doubt phase — show doubts/challenges/verifications. */
const POST_DOUBT_STATES = new Set([
  'doubted', 'challenged', 'scouted', 'verifying', 'verified',
  'resolved', 'compressed', 'merged', 'dead_end',
]);

export async function brief(args: string[], isJson: boolean): Promise<void> {
  const root = findProjectRoot();
  if (!root) throw new Error('Not in a Majlis project. Run `majlis init` first.');

  const db = getDb(root);
  const plain = args.includes('--plain');
  const short = args.includes('--short');

  // ── Gather data ──────────────────────────────────────────

  const exp = getLatestExperiment(db);
  const session = getActiveSession(db);

  const deadEnds = exp?.sub_type
    ? listStructuralDeadEndsBySubType(db, exp.sub_type)
    : listStructuralDeadEnds(db);

  const doubts = exp ? getDoubtsByExperiment(db, exp.id) : [];
  const challenges = exp ? getChallengesByExperiment(db, exp.id) : [];
  const verifications = exp ? getVerificationsByExperiment(db, exp.id) : [];

  const beforeMetrics = exp ? getMetricsByExperimentAndPhase(db, exp.id, 'before') : [];
  const afterMetrics = exp ? getMetricsByExperimentAndPhase(db, exp.id, 'after') : [];

  const notes = getRecentNotes(db, 5);

  // ── JSON output ──────────────────────────────────────────

  if (isJson) {
    const data: Record<string, unknown> = {
      experiment: exp ? {
        slug: exp.slug,
        status: exp.status,
        hypothesis: exp.hypothesis,
        sub_type: exp.sub_type,
      } : null,
      dead_ends: deadEnds.slice(0, 5).map(d => ({
        id: d.id,
        structural_constraint: d.structural_constraint,
      })),
      doubts: doubts.map(d => ({
        claim: d.claim_doubted,
        severity: d.severity,
        resolution: d.resolution,
      })),
      challenges: challenges.map(c => ({
        description: c.description,
      })),
      verifications: verifications.map(v => ({
        component: v.component,
        grade: v.grade,
        notes: v.notes,
      })),
      metrics: beforeMetrics.map(bm => {
        const am = afterMetrics.find(
          a => a.fixture === bm.fixture && a.metric_name === bm.metric_name,
        );
        return {
          fixture: bm.fixture,
          metric: bm.metric_name,
          before: bm.metric_value,
          after: am?.metric_value ?? null,
        };
      }),
      notes: notes.map(n => ({
        tag: n.tag,
        content: n.content,
      })),
      session: session ? { intent: session.intent } : null,
    };
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  // ── ANSI output ──────────────────────────────────────────

  const lines: string[] = [];

  // Section 1: Experiment State
  lines.push(fmt.bold('[majlis] Context Brief'));
  lines.push('');

  if (exp) {
    lines.push(fmt.bold('Experiment'));
    lines.push(`  Slug:       ${fmt.cyan(exp.slug)}`);
    lines.push(`  Status:     ${fmt.statusColor(exp.status)}`);
    if (exp.hypothesis) lines.push(`  Hypothesis: ${exp.hypothesis}`);
    if (exp.sub_type) lines.push(`  Sub-type:   ${fmt.dim(exp.sub_type)}`);
  } else {
    lines.push(fmt.dim('No active experiment.'));
  }

  // Section 2: Dead Ends
  if (deadEnds.length > 0) {
    lines.push('');
    lines.push(fmt.bold('Dead Ends'));
    for (const d of deadEnds.slice(0, 5)) {
      lines.push(`  - ${fmt.dim(`[DE-${d.id}]`)} ${d.structural_constraint}`);
    }
    if (deadEnds.length > 5) {
      lines.push(fmt.dim(`  ... and ${deadEnds.length - 5} more`));
    }
  }

  // Section 3: Doubts / Challenges / Verifications
  if (exp && POST_DOUBT_STATES.has(exp.status)) {
    if (doubts.length > 0) {
      lines.push('');
      lines.push(fmt.bold('Doubts'));
      for (const d of doubts) {
        const res = d.resolution ? fmt.dim(` (${d.resolution})`) : fmt.yellow(' (pending)');
        lines.push(`  - [${d.severity}] ${d.claim_doubted}${res}`);
      }
    }

    if (challenges.length > 0) {
      lines.push('');
      lines.push(fmt.bold('Challenges'));
      for (const c of challenges) {
        lines.push(`  - ${c.description}`);
      }
    }

    if (verifications.length > 0) {
      lines.push('');
      lines.push(fmt.bold('Verifications'));
      for (const v of verifications) {
        const note = v.notes ? fmt.dim(` — ${v.notes}`) : '';
        lines.push(`  - ${v.component}: ${fmt.gradeColor(v.grade)}${note}`);
      }
    }
  }

  // Section 4: Recent Notes
  if (notes.length > 0) {
    lines.push('');
    lines.push(fmt.bold('Recent Notes'));
    for (const n of notes) {
      const tag = n.tag ? fmt.dim(`[${n.tag}] `) : '';
      lines.push(`  - ${tag}${n.content}`);
    }
  }

  // Section 5: Metrics
  if (beforeMetrics.length > 0) {
    lines.push('');
    lines.push(fmt.bold('Metrics'));
    for (const bm of beforeMetrics) {
      const am = afterMetrics.find(
        a => a.fixture === bm.fixture && a.metric_name === bm.metric_name,
      );
      if (am) {
        const delta = am.metric_value - bm.metric_value;
        const sign = delta >= 0 ? '+' : '';
        const color = delta >= 0 ? fmt.green : fmt.red;
        lines.push(`  - ${bm.fixture}/${bm.metric_name}: ${bm.metric_value} -> ${am.metric_value} ${color(`(${sign}${delta.toFixed(4)})`)}`);
      } else {
        lines.push(`  - ${bm.fixture}/${bm.metric_name}: ${bm.metric_value} ${fmt.dim('(no after)')}`);
      }
    }
  }

  // Section 6: Session
  if (session) {
    lines.push('');
    lines.push(fmt.bold('Session'));
    lines.push(`  Intent: ${session.intent}`);
  }

  lines.push('');

  let output = lines.join('\n');

  if (plain) {
    output = fmt.stripAnsi(output);
  }

  if (short && output.length > 3000) {
    output = output.slice(0, 2986) + '\n[TRUNCATED]';
  }

  process.stdout.write(output);
}
