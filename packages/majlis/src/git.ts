import { execSync, execFileSync } from 'node:child_process';
import type { Experiment } from './types.js';
import * as fmt from './output/format.js';

/**
 * Auto-commit framework artifacts (docs/, .majlis/scripts/).
 * Excludes .majlis/majlis.db and other framework internals.
 * Non-fatal — failures are logged as warnings, never thrown.
 */
export function autoCommit(root: string, message: string): void {
  try {
    // Stage docs/ and .majlis/scripts/ only
    try {
      execFileSync('git', ['add', 'docs/', '.majlis/scripts/'], {
        cwd: root, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch { /* paths may not exist — fine */ }

    // Check if there's anything staged
    const diff = execSync('git diff --cached --stat', {
      cwd: root, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();

    if (!diff) return; // Nothing to commit

    execFileSync('git', ['commit', '-m', `[majlis] ${message}`], {
      cwd: root, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
    });
    fmt.info(`Auto-committed: ${message}`);
  } catch {
    // Non-fatal — user can commit manually
  }
}

/**
 * Git cleanup for dead-end transitions.
 * 1. Commits any outstanding builder changes on the experiment branch (preserves diagnostic evidence).
 * 2. Checks out main/master.
 * Non-fatal — all errors are swallowed with warnings. The dead-end record in SQLite
 * is the source of truth; git cleanup is best-effort.
 */
export function handleDeadEndGit(exp: Experiment, root: string): void {
  // Guard: only act if we're actually on the experiment branch
  try {
    const currentBranch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: root, encoding: 'utf-8',
    }).trim();

    if (currentBranch !== exp.branch) return;
  } catch {
    return; // Can't determine branch — bail out safely
  }

  // Step 1: Commit any uncommitted builder changes
  // Same staging pattern as gitCommitBuild (cycle.ts) — stage everything except .majlis/
  try {
    execSync('git add -A -- ":!.majlis/"', {
      cwd: root, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
    });
    const diff = execSync('git diff --cached --stat', {
      cwd: root, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();

    if (diff) {
      const msg = `EXP-${String(exp.id).padStart(3, '0')}: ${exp.slug} [dead-end]`;
      execFileSync('git', ['commit', '-m', msg], {
        cwd: root, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
      });
      fmt.info(`Committed builder changes on ${exp.branch} before dead-end.`);
    }
  } catch {
    // Non-fatal — changes may be lost but the dead-end record is in SQLite
  }

  // Step 2: Checkout main/master
  try {
    execFileSync('git', ['checkout', 'main'], {
      cwd: root, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch {
    try {
      execFileSync('git', ['checkout', 'master'], {
        cwd: root, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch {
      fmt.warn(`Could not switch away from ${exp.branch} — do this manually.`);
    }
  }
}
