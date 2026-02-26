import { execSync, execFileSync } from 'node:child_process';
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
