import type Database from 'better-sqlite3';
import type {
  Experiment, Decision, MetricSnapshot, DeadEnd,
  Verification, Doubt, SubTypeFailure, Session, Compression,
} from '../types.js';

/**
 * All database operations as named functions using prepared statements.
 * Each function takes a db instance so we can test with in-memory DBs.
 */

// ── Experiments ──────────────────────────────────────────────

export function createExperiment(
  db: Database.Database,
  slug: string,
  branch: string,
  hypothesis: string | null,
  subType: string | null,
  classificationRef: string | null,
  dependsOn: string | null = null,
  contextFiles: string[] | null = null,
): Experiment {
  const stmt = db.prepare(`
    INSERT INTO experiments (slug, branch, hypothesis, sub_type, classification_ref, status, depends_on, context_files)
    VALUES (?, ?, ?, ?, ?, 'classified', ?, ?)
  `);
  const contextJson = contextFiles && contextFiles.length > 0 ? JSON.stringify(contextFiles) : null;
  const result = stmt.run(slug, branch, hypothesis, subType, classificationRef, dependsOn, contextJson);
  return getExperimentById(db, result.lastInsertRowid as number)!;
}

/**
 * Check if an experiment's dependency is satisfied (merged).
 * Returns null if no dependency, the dependency experiment otherwise.
 */
export function checkDependency(db: Database.Database, dependsOnSlug: string): Experiment | null {
  return getExperimentBySlug(db, dependsOnSlug);
}

export function getExperimentById(db: Database.Database, id: number): Experiment | null {
  return db.prepare('SELECT * FROM experiments WHERE id = ?').get(id) as Experiment | null;
}

export function getExperimentBySlug(db: Database.Database, slug: string): Experiment | null {
  return db.prepare('SELECT * FROM experiments WHERE slug = ?').get(slug) as Experiment | null;
}

export function updateExperimentStatus(db: Database.Database, id: number, status: string): void {
  db.prepare(`
    UPDATE experiments SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
  `).run(status, id);
}

export function listActiveExperiments(db: Database.Database): Experiment[] {
  return db.prepare(`
    SELECT * FROM experiments WHERE status NOT IN ('merged', 'dead_end')
    ORDER BY created_at DESC
  `).all() as Experiment[];
}

export function listAllExperiments(db: Database.Database): Experiment[] {
  return db.prepare('SELECT * FROM experiments ORDER BY id').all() as Experiment[];
}

export function getLatestExperiment(db: Database.Database): Experiment | null {
  return db.prepare(`
    SELECT * FROM experiments WHERE status NOT IN ('merged', 'dead_end')
    ORDER BY created_at DESC LIMIT 1
  `).get() as Experiment | null;
}

export function storeBuilderGuidance(db: Database.Database, experimentId: number, guidance: string): void {
  db.prepare(`
    UPDATE experiments SET builder_guidance = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
  `).run(guidance, experimentId);
}

export function getBuilderGuidance(db: Database.Database, experimentId: number): string | null {
  const row = db.prepare('SELECT builder_guidance FROM experiments WHERE id = ?').get(experimentId) as { builder_guidance: string | null } | undefined;
  return row?.builder_guidance ?? null;
}

export function storeGateRejection(db: Database.Database, experimentId: number, reason: string): void {
  db.prepare(`
    UPDATE experiments SET gate_rejection_reason = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
  `).run(reason, experimentId);
}

export function clearGateRejection(db: Database.Database, experimentId: number): void {
  db.prepare(`
    UPDATE experiments SET gate_rejection_reason = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?
  `).run(experimentId);
}

// ── Decisions ────────────────────────────────────────────────

export function insertDecision(
  db: Database.Database,
  experimentId: number,
  description: string,
  evidenceLevel: string,
  justification: string,
): Decision {
  const stmt = db.prepare(`
    INSERT INTO decisions (experiment_id, description, evidence_level, justification)
    VALUES (?, ?, ?, ?)
  `);
  const result = stmt.run(experimentId, description, evidenceLevel, justification);
  return db.prepare('SELECT * FROM decisions WHERE id = ?').get(result.lastInsertRowid) as Decision;
}

export function listDecisionsByExperiment(db: Database.Database, experimentId: number): Decision[] {
  return db.prepare(`
    SELECT * FROM decisions WHERE experiment_id = ? ORDER BY created_at
  `).all(experimentId) as Decision[];
}

export function listDecisionsByLevel(db: Database.Database, level: string): Decision[] {
  return db.prepare(`
    SELECT * FROM decisions WHERE evidence_level = ? AND status = 'active' ORDER BY created_at
  `).all(level) as Decision[];
}

export function listAllDecisions(db: Database.Database, level?: string, experimentId?: number): Decision[] {
  if (level && experimentId) {
    return db.prepare(`
      SELECT * FROM decisions WHERE evidence_level = ? AND experiment_id = ? ORDER BY created_at
    `).all(level, experimentId) as Decision[];
  }
  if (level) return listDecisionsByLevel(db, level);
  if (experimentId) return listDecisionsByExperiment(db, experimentId);
  return db.prepare('SELECT * FROM decisions ORDER BY created_at').all() as Decision[];
}

export function overturnDecision(db: Database.Database, decisionId: number, overturnedByDecisionId: number): void {
  db.prepare(`
    UPDATE decisions SET status = 'overturned', overturned_by = ? WHERE id = ?
  `).run(overturnedByDecisionId, decisionId);
}

// ── Metrics ──────────────────────────────────────────────────

export function insertMetric(
  db: Database.Database,
  experimentId: number,
  phase: string,
  fixture: string,
  metricName: string,
  metricValue: number,
): MetricSnapshot {
  const stmt = db.prepare(`
    INSERT INTO metrics (experiment_id, phase, fixture, metric_name, metric_value)
    VALUES (?, ?, ?, ?, ?)
  `);
  const result = stmt.run(experimentId, phase, fixture, metricName, metricValue);
  return db.prepare('SELECT * FROM metrics WHERE id = ?').get(result.lastInsertRowid) as MetricSnapshot;
}

export function getMetricsByExperimentAndPhase(
  db: Database.Database,
  experimentId: number,
  phase: string,
): MetricSnapshot[] {
  return db.prepare(`
    SELECT * FROM metrics WHERE experiment_id = ? AND phase = ?
  `).all(experimentId, phase) as MetricSnapshot[];
}

export function getMetricHistoryByFixture(db: Database.Database, fixture: string): MetricSnapshot[] {
  return db.prepare(`
    SELECT m.*, e.slug as experiment_slug FROM metrics m
    JOIN experiments e ON m.experiment_id = e.id
    WHERE m.fixture = ?
    ORDER BY m.captured_at
  `).all(fixture) as MetricSnapshot[];
}

// ── Dead Ends ────────────────────────────────────────────────

export function insertDeadEnd(
  db: Database.Database,
  experimentId: number,
  approach: string,
  whyFailed: string,
  structuralConstraint: string,
  subType: string | null,
  category: 'structural' | 'procedural' = 'structural',
): DeadEnd {
  const stmt = db.prepare(`
    INSERT INTO dead_ends (experiment_id, approach, why_failed, structural_constraint, sub_type, category)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const result = stmt.run(experimentId, approach, whyFailed, structuralConstraint, subType, category);
  return db.prepare('SELECT * FROM dead_ends WHERE id = ?').get(result.lastInsertRowid) as DeadEnd;
}

export function listDeadEndsBySubType(db: Database.Database, subType: string): DeadEnd[] {
  return db.prepare(`
    SELECT * FROM dead_ends WHERE sub_type = ? ORDER BY created_at
  `).all(subType) as DeadEnd[];
}

export function listAllDeadEnds(db: Database.Database): DeadEnd[] {
  return db.prepare('SELECT * FROM dead_ends ORDER BY created_at').all() as DeadEnd[];
}

export function searchDeadEnds(db: Database.Database, term: string): DeadEnd[] {
  const pattern = `%${term}%`;
  return db.prepare(`
    SELECT * FROM dead_ends
    WHERE approach LIKE ? OR why_failed LIKE ? OR structural_constraint LIKE ?
    ORDER BY created_at
  `).all(pattern, pattern, pattern) as DeadEnd[];
}

// ── Verifications ────────────────────────────────────────────

export function insertVerification(
  db: Database.Database,
  experimentId: number,
  component: string,
  grade: string,
  provenanceIntact: boolean | null,
  contentCorrect: boolean | null,
  notes: string | null,
): Verification {
  const stmt = db.prepare(`
    INSERT INTO verifications (experiment_id, component, grade, provenance_intact, content_correct, notes)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const result = stmt.run(
    experimentId, component, grade,
    provenanceIntact === null ? null : provenanceIntact ? 1 : 0,
    contentCorrect === null ? null : contentCorrect ? 1 : 0,
    notes,
  );
  return db.prepare('SELECT * FROM verifications WHERE id = ?').get(result.lastInsertRowid) as Verification;
}

export function getVerificationsByExperiment(db: Database.Database, experimentId: number): Verification[] {
  return db.prepare(`
    SELECT * FROM verifications WHERE experiment_id = ? ORDER BY created_at
  `).all(experimentId) as Verification[];
}

export function getConfirmedDoubts(db: Database.Database, experimentId: number): Doubt[] {
  return db.prepare(`
    SELECT * FROM doubts WHERE experiment_id = ? AND resolution = 'confirmed'
  `).all(experimentId) as Doubt[];
}

// ── Doubts ───────────────────────────────────────────────────

export function insertDoubt(
  db: Database.Database,
  experimentId: number,
  claimDoubted: string,
  evidenceLevelOfClaim: string,
  evidenceForDoubt: string,
  severity: string,
): Doubt {
  const stmt = db.prepare(`
    INSERT INTO doubts (experiment_id, claim_doubted, evidence_level_of_claim, evidence_for_doubt, severity)
    VALUES (?, ?, ?, ?, ?)
  `);
  const result = stmt.run(experimentId, claimDoubted, evidenceLevelOfClaim, evidenceForDoubt, severity);
  return db.prepare('SELECT * FROM doubts WHERE id = ?').get(result.lastInsertRowid) as Doubt;
}

export function getDoubtsByExperiment(db: Database.Database, experimentId: number): Doubt[] {
  return db.prepare(`
    SELECT * FROM doubts WHERE experiment_id = ? ORDER BY created_at
  `).all(experimentId) as Doubt[];
}

export function updateDoubtResolution(db: Database.Database, doubtId: number, resolution: string): void {
  db.prepare('UPDATE doubts SET resolution = ? WHERE id = ?').run(resolution, doubtId);
}

export function hasDoubts(db: Database.Database, experimentId: number): boolean {
  const row = db.prepare('SELECT COUNT(*) as count FROM doubts WHERE experiment_id = ?').get(experimentId) as { count: number };
  return row.count > 0;
}

export function hasChallenges(db: Database.Database, experimentId: number): boolean {
  const row = db.prepare('SELECT COUNT(*) as count FROM challenges WHERE experiment_id = ?').get(experimentId) as { count: number };
  return row.count > 0;
}

export function insertChallenge(
  db: Database.Database,
  experimentId: number,
  description: string,
  reasoning: string,
): { id: number; experiment_id: number; description: string; reasoning: string } {
  const stmt = db.prepare(`
    INSERT INTO challenges (experiment_id, description, reasoning) VALUES (?, ?, ?)
  `);
  const result = stmt.run(experimentId, description, reasoning);
  return db.prepare('SELECT * FROM challenges WHERE id = ?').get(result.lastInsertRowid) as any;
}

export function getChallengesByExperiment(db: Database.Database, experimentId: number): Array<{ id: number; experiment_id: number; description: string; reasoning: string; created_at: string }> {
  return db.prepare('SELECT * FROM challenges WHERE experiment_id = ? ORDER BY created_at').all(experimentId) as any[];
}

// ── Sub-Type Failures (Circuit Breakers) ─────────────────────

export function incrementSubTypeFailure(
  db: Database.Database,
  subType: string,
  experimentId: number,
  grade: string,
): void {
  db.prepare(`
    INSERT INTO sub_type_failures (sub_type, experiment_id, grade)
    VALUES (?, ?, ?)
  `).run(subType, experimentId, grade);
}

export function getSubTypeFailures(db: Database.Database, subType: string): SubTypeFailure[] {
  return db.prepare(`
    SELECT * FROM sub_type_failures WHERE sub_type = ? ORDER BY created_at
  `).all(subType) as SubTypeFailure[];
}

export function getSubTypeFailureCount(db: Database.Database, subType: string): number {
  const row = db.prepare(`
    SELECT COUNT(*) as count FROM sub_type_failures
    WHERE sub_type = ? AND grade IN ('weak', 'rejected')
  `).get(subType) as { count: number };
  return row.count;
}

export function checkCircuitBreaker(db: Database.Database, subType: string, threshold: number): boolean {
  return getSubTypeFailureCount(db, subType) >= threshold;
}

export function getAllCircuitBreakerStates(db: Database.Database, threshold: number): Array<{ sub_type: string; failure_count: number; tripped: boolean }> {
  const rows = db.prepare(`
    SELECT sub_type, COUNT(*) as failure_count
    FROM sub_type_failures
    WHERE grade IN ('weak', 'rejected')
    GROUP BY sub_type
  `).all() as Array<{ sub_type: string; failure_count: number }>;
  return rows.map(r => ({ ...r, tripped: r.failure_count >= threshold }));
}

// ── Sessions ─────────────────────────────────────────────────

export function startSession(
  db: Database.Database,
  intent: string,
  experimentId: number | null,
): Session {
  const stmt = db.prepare(`
    INSERT INTO sessions (intent, experiment_id) VALUES (?, ?)
  `);
  const result = stmt.run(intent, experimentId);
  return db.prepare('SELECT * FROM sessions WHERE id = ?').get(result.lastInsertRowid) as Session;
}

export function endSession(
  db: Database.Database,
  sessionId: number,
  accomplished: string | null,
  unfinished: string | null,
  newFragility: string | null,
): void {
  db.prepare(`
    UPDATE sessions SET ended_at = CURRENT_TIMESTAMP,
    accomplished = ?, unfinished = ?, new_fragility = ?
    WHERE id = ?
  `).run(accomplished, unfinished, newFragility, sessionId);
}

export function getActiveSession(db: Database.Database): Session | null {
  return db.prepare(`
    SELECT * FROM sessions WHERE ended_at IS NULL ORDER BY started_at DESC LIMIT 1
  `).get() as Session | null;
}

export function getSessionsSinceCompression(db: Database.Database): number {
  const lastCompression = db.prepare(`
    SELECT created_at FROM compressions ORDER BY created_at DESC LIMIT 1
  `).get() as { created_at: string } | undefined;

  if (!lastCompression) {
    const row = db.prepare('SELECT COUNT(*) as count FROM sessions').get() as { count: number };
    return row.count;
  }

  const row = db.prepare(`
    SELECT COUNT(*) as count FROM sessions WHERE started_at > ?
  `).get(lastCompression.created_at) as { count: number };
  return row.count;
}

// ── Compressions ─────────────────────────────────────────────

export function recordCompression(
  db: Database.Database,
  sessionCountSinceLast: number,
  synthesisSizeBefore: number,
  synthesisSizeAfter: number,
): Compression {
  const stmt = db.prepare(`
    INSERT INTO compressions (session_count_since_last, synthesis_size_before, synthesis_size_after)
    VALUES (?, ?, ?)
  `);
  const result = stmt.run(sessionCountSinceLast, synthesisSizeBefore, synthesisSizeAfter);
  return db.prepare('SELECT * FROM compressions WHERE id = ?').get(result.lastInsertRowid) as Compression;
}

export function getLastCompression(db: Database.Database): Compression | null {
  return db.prepare(`
    SELECT * FROM compressions ORDER BY created_at DESC LIMIT 1
  `).get() as Compression | null;
}

// ── Structural Dead Ends ────────────────────────────────────

export function listStructuralDeadEnds(db: Database.Database): DeadEnd[] {
  return db.prepare(`
    SELECT * FROM dead_ends WHERE category = 'structural' ORDER BY created_at
  `).all() as DeadEnd[];
}

export function listStructuralDeadEndsBySubType(db: Database.Database, subType: string): DeadEnd[] {
  return db.prepare(`
    SELECT * FROM dead_ends WHERE category = 'structural' AND sub_type = ? ORDER BY created_at
  `).all(subType) as DeadEnd[];
}

// ── Reframes ────────────────────────────────────────────────

export function insertReframe(
  db: Database.Database,
  experimentId: number,
  decomposition: string,
  divergences: string,
  recommendation: string,
): void {
  db.prepare(`
    INSERT INTO reframes (experiment_id, decomposition, divergences, recommendation)
    VALUES (?, ?, ?, ?)
  `).run(experimentId, decomposition, divergences, recommendation);
}

export function getReframesByExperiment(db: Database.Database, experimentId: number) {
  return db.prepare('SELECT * FROM reframes WHERE experiment_id = ? ORDER BY created_at').all(experimentId);
}

// ── Findings ────────────────────────────────────────────────

export function insertFinding(
  db: Database.Database,
  experimentId: number,
  approach: string,
  source: string,
  relevance: string,
  contradictsCurrent: boolean,
): void {
  db.prepare(`
    INSERT INTO findings (experiment_id, approach, source, relevance, contradicts_current)
    VALUES (?, ?, ?, ?, ?)
  `).run(experimentId, approach, source, relevance, contradictsCurrent ? 1 : 0);
}

export function getFindingsByExperiment(db: Database.Database, experimentId: number) {
  return db.prepare('SELECT * FROM findings WHERE experiment_id = ? ORDER BY created_at').all(experimentId);
}

// ── Swarm Tracking ─────────────────────────────────────────

export function createSwarmRun(
  db: Database.Database, goal: string, parallelCount: number,
): { id: number } {
  const result = db.prepare(`
    INSERT INTO swarm_runs (goal, parallel_count) VALUES (?, ?)
  `).run(goal, parallelCount);
  return { id: result.lastInsertRowid as number };
}

export function updateSwarmRun(
  db: Database.Database, id: number,
  status: string, totalCostUsd: number, bestSlug: string | null,
): void {
  db.prepare(`
    UPDATE swarm_runs SET status = ?, total_cost_usd = ?, best_experiment_slug = ?,
      completed_at = CURRENT_TIMESTAMP WHERE id = ?
  `).run(status, totalCostUsd, bestSlug, id);
}

export function addSwarmMember(
  db: Database.Database, swarmRunId: number, slug: string, worktreePath: string,
): void {
  db.prepare(`
    INSERT INTO swarm_members (swarm_run_id, experiment_slug, worktree_path) VALUES (?, ?, ?)
  `).run(swarmRunId, slug, worktreePath);
}

export function updateSwarmMember(
  db: Database.Database, swarmRunId: number, slug: string,
  finalStatus: string, overallGrade: string | null, costUsd: number, error: string | null,
): void {
  db.prepare(`
    UPDATE swarm_members SET final_status = ?, overall_grade = ?, cost_usd = ?, error = ?
    WHERE swarm_run_id = ? AND experiment_slug = ?
  `).run(finalStatus, overallGrade, costUsd, error, swarmRunId, slug);
}

// ── Compressor Export ───────────────────────────────────────

/**
 * Export structured data for the compressor agent.
 * Returns formatted markdown with all structured data from the DB.
 */
export function exportForCompressor(db: Database.Database, maxLength: number = 50000): string {
  const experiments = listAllExperiments(db);
  const sections: string[] = ['# Structured Data Export (from SQLite)\n'];

  sections.push('## Experiments');
  for (const exp of experiments) {
    sections.push(`### EXP-${String(exp.id).padStart(3, '0')}: ${exp.slug}`);
    sections.push(`- Status: ${exp.status} | Sub-type: ${exp.sub_type ?? '(none)'}`);
    sections.push(`- Hypothesis: ${exp.hypothesis ?? '(none)'}`);

    const decisions = listDecisionsByExperiment(db, exp.id);
    if (decisions.length > 0) {
      sections.push(`#### Decisions (${decisions.length})`);
      for (const d of decisions) {
        sections.push(`- [${d.evidence_level}] ${d.description} — ${d.justification} (${d.status})`);
      }
    }

    const doubts = getDoubtsByExperiment(db, exp.id);
    if (doubts.length > 0) {
      sections.push(`#### Doubts (${doubts.length})`);
      for (const d of doubts) {
        sections.push(`- [${d.severity}] ${d.claim_doubted} (resolution: ${d.resolution ?? 'pending'})`);
      }
    }

    const verifications = getVerificationsByExperiment(db, exp.id);
    if (verifications.length > 0) {
      sections.push(`#### Verifications (${verifications.length})`);
      for (const v of verifications) {
        sections.push(`- ${v.component}: ${v.grade}${v.notes ? ` — ${v.notes}` : ''}`);
      }
    }

    const challenges = getChallengesByExperiment(db, exp.id);
    if (challenges.length > 0) {
      sections.push(`#### Challenges (${challenges.length})`);
      for (const c of challenges) {
        sections.push(`- ${c.description}`);
      }
    }

    sections.push('');
  }

  const deadEnds = listAllDeadEnds(db);
  if (deadEnds.length > 0) {
    sections.push('## Dead Ends');
    for (const de of deadEnds) {
      sections.push(`- [${de.category ?? 'structural'}] ${de.approach}: ${de.why_failed} → ${de.structural_constraint}`);
    }
    sections.push('');
  }

  const unresolvedDoubts = db.prepare(`
    SELECT d.*, e.slug as experiment_slug
    FROM doubts d JOIN experiments e ON d.experiment_id = e.id
    WHERE d.resolution IS NULL
    ORDER BY d.severity DESC, d.created_at
  `).all() as Array<Doubt & { experiment_slug: string }>;

  if (unresolvedDoubts.length > 0) {
    sections.push('## Unresolved Doubts');
    for (const d of unresolvedDoubts) {
      sections.push(`- [${d.severity}] ${d.claim_doubted} (exp: ${d.experiment_slug})`);
    }
  }

  const full = sections.join('\n');
  if (full.length > maxLength) {
    return full.slice(0, maxLength) + `\n\n[TRUNCATED — full export was ${full.length} chars]`;
  }
  return full;
}

/**
 * Export structured lineage for experiments sharing the same sub-type.
 * Tradition 1 (Hafiz): Agents need access to structured ground truth, not just compressed form.
 * Tradition 14 (Shura): Inject raw evaluations so consultation is genuine.
 * Returns decisions, metric deltas, doubt resolutions, and dead-end constraints.
 */
export function exportExperimentLineage(
  db: Database.Database,
  subType: string | null,
  maxLength: number = 15000,
): string {
  // Query all experiments with the same sub_type (or all if null)
  const experiments = subType
    ? db.prepare(`SELECT * FROM experiments WHERE sub_type = ? ORDER BY created_at`).all(subType) as Experiment[]
    : listAllExperiments(db);

  if (experiments.length === 0) return '';

  const sections: string[] = ['## Experiment Lineage (from DB — canonical, not from synthesis)\n'];

  for (const exp of experiments) {
    sections.push(`### ${exp.slug} [${exp.status}]`);
    if (exp.hypothesis) sections.push(`Hypothesis: ${exp.hypothesis}`);

    // Decisions with evidence levels
    const decisions = listDecisionsByExperiment(db, exp.id);
    if (decisions.length > 0) {
      sections.push('Decisions:');
      for (const d of decisions) {
        sections.push(`  - [${d.evidence_level}/${d.status}] ${d.description}`);
      }
    }

    // Metric deltas (before→after comparisons)
    const beforeMetrics = getMetricsByExperimentAndPhase(db, exp.id, 'before');
    const afterMetrics = getMetricsByExperimentAndPhase(db, exp.id, 'after');
    if (beforeMetrics.length > 0 && afterMetrics.length > 0) {
      sections.push('Metrics:');
      for (const bm of beforeMetrics) {
        const am = afterMetrics.find(a => a.fixture === bm.fixture && a.metric_name === bm.metric_name);
        if (am) {
          const delta = am.metric_value - bm.metric_value;
          const sign = delta >= 0 ? '+' : '';
          sections.push(`  - ${bm.fixture}/${bm.metric_name}: ${bm.metric_value} → ${am.metric_value} (${sign}${delta.toFixed(4)})`);
        }
      }
    }

    // Doubt resolutions
    const doubts = getDoubtsByExperiment(db, exp.id);
    const resolved = doubts.filter(d => d.resolution);
    if (resolved.length > 0) {
      sections.push('Doubt resolutions:');
      for (const d of resolved) {
        sections.push(`  - [${d.resolution}] ${d.claim_doubted}`);
      }
    }

    // Verifications
    const verifications = getVerificationsByExperiment(db, exp.id);
    if (verifications.length > 0) {
      sections.push('Grades:');
      for (const v of verifications) {
        sections.push(`  - ${v.component}: ${v.grade}${v.notes ? ` — ${v.notes}` : ''}`);
      }
    }

    sections.push('');

    // Early exit if we're getting close to the limit
    const current = sections.join('\n');
    if (current.length > maxLength - 500) {
      sections.push(`[LINEAGE TRUNCATED — ${experiments.length - experiments.indexOf(exp) - 1} experiments omitted]`);
      break;
    }
  }

  // Dead ends for this sub-type (outside experiment loop — these are structural constraints)
  const deadEnds = subType
    ? listDeadEndsBySubType(db, subType)
    : listAllDeadEnds(db);

  if (deadEnds.length > 0) {
    sections.push('### Dead Ends (structural constraints)');
    for (const de of deadEnds) {
      sections.push(`- [${de.category ?? 'structural'}] ${de.approach}: ${de.structural_constraint}`);
    }
  }

  const full = sections.join('\n');
  if (full.length > maxLength) {
    return full.slice(0, maxLength) + `\n\n[LINEAGE TRUNCATED at ${maxLength} chars]`;
  }
  return full;
}

/**
 * Extended DB export for the diagnostician agent.
 * Includes everything from exportForCompressor plus metric history,
 * session history, compression history, swarm runs, reframes, and findings.
 */
export function exportForDiagnostician(db: Database.Database, maxLength: number = 60000): string {
  const base = exportForCompressor(db, maxLength);
  const sections: string[] = [base];

  // Metric history across all experiments
  const metrics = db.prepare(`
    SELECT m.*, e.slug FROM metrics m
    JOIN experiments e ON m.experiment_id = e.id
    ORDER BY m.captured_at
  `).all() as Array<MetricSnapshot & { slug: string }>;

  if (metrics.length > 0) {
    sections.push('\n## Metric History (all experiments)');
    for (const m of metrics) {
      sections.push(`- ${m.slug} [${m.phase}] ${m.fixture}/${m.metric_name}: ${m.metric_value}`);
    }
  }

  // Session history
  const sessions = db.prepare('SELECT * FROM sessions ORDER BY started_at').all() as Session[];
  if (sessions.length > 0) {
    sections.push('\n## Session History');
    for (const s of sessions) {
      sections.push(`- #${s.id}: "${s.intent}" (${s.ended_at ? 'ended' : 'active'})`);
      if (s.accomplished) sections.push(`  accomplished: ${s.accomplished}`);
      if (s.unfinished) sections.push(`  unfinished: ${s.unfinished}`);
      if (s.new_fragility) sections.push(`  fragility: ${s.new_fragility}`);
    }
  }

  // Compression history
  const compressions = db.prepare('SELECT * FROM compressions ORDER BY created_at').all() as Compression[];
  if (compressions.length > 0) {
    sections.push('\n## Compression History');
    for (const c of compressions) {
      sections.push(`- #${c.id}: ${c.synthesis_size_before}B → ${c.synthesis_size_after}B (${c.session_count_since_last} sessions)`);
    }
  }

  // Swarm run history (table may not exist in older DBs)
  try {
    const swarmRuns = db.prepare('SELECT * FROM swarm_runs ORDER BY created_at').all() as Array<Record<string, unknown>>;
    if (swarmRuns.length > 0) {
      sections.push('\n## Swarm History');
      for (const sr of swarmRuns) {
        sections.push(`- #${sr.id}: "${sr.goal}" (${sr.status}, best: ${sr.best_experiment_slug ?? 'none'})`);
      }
    }
  } catch { /* swarm tables may not exist */ }

  // Reframe history
  const reframes = db.prepare(`
    SELECT r.*, e.slug FROM reframes r
    JOIN experiments e ON r.experiment_id = e.id
    ORDER BY r.created_at
  `).all() as Array<Record<string, unknown>>;
  if (reframes.length > 0) {
    sections.push('\n## Reframe History');
    for (const r of reframes) {
      const decomp = String(r.decomposition ?? '').slice(0, 200);
      sections.push(`- ${r.slug}: ${decomp}`);
      if (r.recommendation) sections.push(`  recommendation: ${String(r.recommendation).slice(0, 200)}`);
    }
  }

  // Scout findings
  const findings = db.prepare(`
    SELECT f.*, e.slug FROM findings f
    JOIN experiments e ON f.experiment_id = e.id
    ORDER BY f.created_at
  `).all() as Array<Record<string, unknown>>;
  if (findings.length > 0) {
    sections.push('\n## Scout Findings');
    for (const f of findings) {
      sections.push(`- ${f.slug}: ${f.approach} (${f.source}) ${f.contradicts_current ? '[CONTRADICTS CURRENT]' : ''}`);
    }
  }

  const full = sections.join('\n');
  if (full.length > maxLength) {
    return full.slice(0, maxLength) + `\n\n[TRUNCATED — full export was ${full.length} chars]`;
  }
  return full;
}
