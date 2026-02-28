/**
 * Project readiness validation for Majlis.
 * Runs diagnostic checks and surfaces what's configured, what's missing,
 * and what the consequences are. Purely informational — never blocks.
 */

export interface ValidationCheck {
  label: string;
  status: 'pass' | 'warn' | 'fail';
  detail: string;
}

/**
 * Validate project readiness given config and filesystem checks.
 * Accepts pre-resolved booleans so the caller handles fs/exec logic.
 */
export function validateProject(checks: {
  hasGitRepo: boolean;
  hasClaudeMd: boolean;
  metricsCommand: string;
  metricsCommandRunnable: boolean;
  fixtures: Record<string, { gate?: boolean }> | string[];
  tracked: Record<string, { direction: string; target?: number }>;
  preMeasure: string | null;
  hasObjective: boolean;
  hasSynthesis: boolean;
}): ValidationCheck[] {
  const results: ValidationCheck[] = [];

  // Git repository
  results.push(checks.hasGitRepo
    ? { label: 'Git repository', status: 'pass', detail: 'Detected' }
    : { label: 'Git repository', status: 'fail', detail: 'Not a git repo — experiment branches will not work' }
  );

  // Project objective
  results.push(checks.hasObjective
    ? { label: 'Project objective', status: 'pass', detail: 'Set in config' }
    : { label: 'Project objective', status: 'warn', detail: 'Not set — agents lack goal context for maqasid checks' }
  );

  // CLAUDE.md
  results.push(checks.hasClaudeMd
    ? { label: 'CLAUDE.md', status: 'pass', detail: 'Found — agents will have project context' }
    : { label: 'CLAUDE.md', status: 'warn', detail: 'Not found — agents will lack project architecture context' }
  );

  // Metrics command
  const hasCommand = checks.metricsCommand && !checks.metricsCommand.includes('echo \'{"fixtures":{}}\'');
  if (!hasCommand) {
    results.push({ label: 'Metrics command', status: 'warn', detail: 'Using default no-op — configure metrics.command for automatic regression detection' });
  } else if (!checks.metricsCommandRunnable) {
    results.push({ label: 'Metrics command', status: 'warn', detail: 'Set but not runnable — check the command works: ' + checks.metricsCommand });
  } else {
    results.push({ label: 'Metrics command', status: 'pass', detail: 'Set and runnable' });
  }

  // Fixtures
  const fixtureEntries = Array.isArray(checks.fixtures)
    ? checks.fixtures
    : Object.keys(checks.fixtures);
  if (fixtureEntries.length === 0) {
    results.push({ label: 'Fixtures', status: 'warn', detail: 'None defined — consider adding fixtures with gate flags for regression protection' });
  } else {
    const gateCount = Array.isArray(checks.fixtures)
      ? 0
      : Object.values(checks.fixtures).filter(f => f.gate).length;
    if (gateCount === 0) {
      results.push({ label: 'Fixtures', status: 'warn', detail: `${fixtureEntries.length} fixture(s) but none flagged as gate — no regression protection` });
    } else {
      results.push({ label: 'Fixtures', status: 'pass', detail: `${fixtureEntries.length} fixture(s), ${gateCount} gate(s)` });
    }
  }

  // Tracked metrics
  const trackedCount = Object.keys(checks.tracked).length;
  if (trackedCount === 0) {
    results.push({ label: 'Tracked metrics', status: 'warn', detail: 'None defined — regression detection disabled' });
  } else {
    results.push({ label: 'Tracked metrics', status: 'pass', detail: `${trackedCount} metric(s) tracked` });
  }

  // Build command
  results.push(checks.preMeasure
    ? { label: 'Build command', status: 'pass', detail: 'Set (pre_measure)' }
    : { label: 'Build command', status: 'warn', detail: 'No pre_measure — builder must know how to build from CLAUDE.md' }
  );

  // Synthesis
  results.push(checks.hasSynthesis
    ? { label: 'Synthesis document', status: 'pass', detail: 'Found' }
    : { label: 'Synthesis document', status: 'warn', detail: 'Empty — will be populated after first compression cycle' }
  );

  return results;
}

// Local NO_COLOR gate — shared is independent of majlis, no cross-package import.
const _useColor = !process.env.NO_COLOR && (process.stderr?.isTTY !== false);

/**
 * Format validation results for terminal output.
 */
export function formatValidation(checks: ValidationCheck[]): string {
  const lines: string[] = [];
  for (const c of checks) {
    const icon = c.status === 'pass' ? (_useColor ? '\x1b[32m✓\x1b[0m' : '✓')
               : c.status === 'warn' ? (_useColor ? '\x1b[33m⚠\x1b[0m' : '⚠')
               : (_useColor ? '\x1b[31m✗\x1b[0m' : '✗');
    lines.push(`  ${icon} ${c.label}: ${c.detail}`);
  }
  return lines.join('\n');
}
