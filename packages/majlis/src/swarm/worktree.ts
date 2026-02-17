import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import { openDbAt } from '../db/connection.js';
import type { WorktreeInfo } from './types.js';
import * as fmt from '../output/format.js';

/**
 * Create a git worktree for a swarm experiment.
 * The worktree is a sibling directory of the main project.
 */
export function createWorktree(
  mainRoot: string,
  slug: string,
  paddedNum: string,
): WorktreeInfo {
  const projectName = path.basename(mainRoot);
  const worktreeName = `${projectName}-swarm-${paddedNum}-${slug}`;
  const worktreePath = path.join(path.dirname(mainRoot), worktreeName);
  const branch = `swarm/${paddedNum}-${slug}`;

  execSync(`git worktree add ${JSON.stringify(worktreePath)} -b ${branch}`, {
    cwd: mainRoot,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  return {
    path: worktreePath,
    branch,
    slug,
    hypothesis: '', // filled in by caller
    paddedNum,
  };
}

/**
 * Initialize a worktree with Majlis config, agents, synthesis context, and a fresh DB.
 * Copies the minimum needed for an independent experiment lifecycle.
 */
export function initializeWorktree(mainRoot: string, worktreePath: string): void {
  const majlisDir = path.join(worktreePath, '.majlis');
  fs.mkdirSync(majlisDir, { recursive: true });

  // Copy config.json
  const configSrc = path.join(mainRoot, '.majlis', 'config.json');
  if (fs.existsSync(configSrc)) {
    fs.copyFileSync(configSrc, path.join(majlisDir, 'config.json'));
  }

  // Copy agent definitions
  const agentsSrc = path.join(mainRoot, '.majlis', 'agents');
  if (fs.existsSync(agentsSrc)) {
    const agentsDst = path.join(majlisDir, 'agents');
    fs.mkdirSync(agentsDst, { recursive: true });
    for (const file of fs.readdirSync(agentsSrc)) {
      fs.copyFileSync(path.join(agentsSrc, file), path.join(agentsDst, file));
    }
  }

  // Copy synthesis docs (so the experiment has accumulated context)
  const synthSrc = path.join(mainRoot, 'docs', 'synthesis');
  if (fs.existsSync(synthSrc)) {
    const synthDst = path.join(worktreePath, 'docs', 'synthesis');
    fs.mkdirSync(synthDst, { recursive: true });
    for (const file of fs.readdirSync(synthSrc)) {
      const srcFile = path.join(synthSrc, file);
      if (fs.statSync(srcFile).isFile()) {
        fs.copyFileSync(srcFile, path.join(synthDst, file));
      }
    }
  }

  // Copy experiment template
  const templateSrc = path.join(mainRoot, 'docs', 'experiments', '_TEMPLATE.md');
  if (fs.existsSync(templateSrc)) {
    const expDir = path.join(worktreePath, 'docs', 'experiments');
    fs.mkdirSync(expDir, { recursive: true });
    fs.copyFileSync(templateSrc, path.join(expDir, '_TEMPLATE.md'));
  }

  // Open fresh DB (runs migrations, starts empty)
  const db = openDbAt(worktreePath);
  db.close();
}

/**
 * Remove a worktree and prune stale entries.
 */
export function cleanupWorktree(mainRoot: string, wt: WorktreeInfo): void {
  try {
    execSync(`git worktree remove ${JSON.stringify(wt.path)} --force`, {
      cwd: mainRoot,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch {
    fmt.warn(`Could not remove worktree ${wt.path} — remove manually.`);
  }

  // Also delete the branch
  try {
    execSync(`git branch -D ${wt.branch}`, {
      cwd: mainRoot,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch { /* branch may not exist or already deleted */ }

  try {
    execSync('git worktree prune', {
      cwd: mainRoot,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch { /* prune is best-effort */ }
}
