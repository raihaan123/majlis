import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import { getDb, findProjectRoot } from '../db/connection.js';
import { exportForDiagnostician } from '../db/queries.js';
import { spawnAgent } from '../agents/spawn.js';
import { loadConfig, readFileOrEmpty } from '../config.js';
import { autoCommit } from '../git.js';
import * as fmt from '../output/format.js';

/**
 * `majlis diagnose ["focus area"] [--keep-scripts]`
 *
 * Deep project-wide diagnostic analysis. The diagnostician agent gets
 * 60 turns, full DB history, and can write/run analysis scripts in
 * .majlis/scripts/ (structurally guarded via PreToolUse hooks).
 */
export async function diagnose(args: string[]): Promise<void> {
  const root = findProjectRoot();
  if (!root) throw new Error('Not in a Majlis project. Run `majlis init` first.');

  const db = getDb(root);
  const focus = args.filter(a => !a.startsWith('--')).join(' ');
  const keepScripts = args.includes('--keep-scripts');

  // Create scripts directory for the diagnostician
  const scriptsDir = path.join(root, '.majlis', 'scripts');
  if (!fs.existsSync(scriptsDir)) {
    fs.mkdirSync(scriptsDir, { recursive: true });
  }

  fmt.header('Deep Diagnosis');
  if (focus) fmt.info(`Focus: ${focus}`);

  // Gather full context — NO truncation for the diagnostician
  const dbExport = exportForDiagnostician(db);
  const synthesis = readFileOrEmpty(path.join(root, 'docs', 'synthesis', 'current.md'));
  const fragility = readFileOrEmpty(path.join(root, 'docs', 'synthesis', 'fragility.md'));
  const deadEndsDoc = readFileOrEmpty(path.join(root, 'docs', 'synthesis', 'dead-ends.md'));
  const config = loadConfig(root);

  // Run current metrics if configured
  let metricsOutput = '';
  if (config.metrics?.command) {
    try {
      metricsOutput = execSync(config.metrics.command, {
        cwd: root, encoding: 'utf-8', timeout: 60_000,
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();
    } catch {
      metricsOutput = '(metrics command failed)';
    }
  }

  let taskPrompt = `## Full Database Export (CANONICAL — source of truth)\n${dbExport}\n\n`;
  taskPrompt += `## Current Synthesis\n${synthesis || '(empty — no experiments yet)'}\n\n`;
  taskPrompt += `## Fragility Map\n${fragility || '(none)'}\n\n`;
  taskPrompt += `## Dead-End Registry\n${deadEndsDoc || '(none)'}\n\n`;
  taskPrompt += `## Current Metrics\n${metricsOutput || '(no metrics configured)'}\n\n`;
  taskPrompt += `## Project Objective\n${config.project?.objective || '(not specified)'}\n\n`;

  if (focus) {
    taskPrompt += `## Focus Area\nThe user has asked you to focus your diagnosis on: ${focus}\n\n`;
  }

  taskPrompt += `## Your Task\nPerform a deep diagnostic analysis of this project. ` +
    `Identify root causes, recurring patterns, evidence gaps, and investigation directions. ` +
    `You have 60 turns — use them for depth. Write analysis scripts to .majlis/scripts/ as needed.\n\n` +
    `Remember: you may write files ONLY to .majlis/scripts/. You cannot modify project code.`;

  fmt.info('Spawning diagnostician (60 turns, full DB access)...');
  const result = await spawnAgent('diagnostician', { taskPrompt }, root);

  // Write diagnostic report
  const diagnosisDir = path.join(root, 'docs', 'diagnosis');
  if (!fs.existsSync(diagnosisDir)) {
    fs.mkdirSync(diagnosisDir, { recursive: true });
  }
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const artifactPath = path.join(diagnosisDir, `diagnosis-${timestamp}.md`);
  fs.writeFileSync(artifactPath, result.output);
  fmt.info(`Diagnostic report: docs/diagnosis/diagnosis-${timestamp}.md`);

  // Log structured insights if available
  if (result.structured?.diagnosis) {
    const d = result.structured.diagnosis;
    if (d.root_causes?.length) {
      fmt.info(`Root causes identified: ${d.root_causes.length}`);
    }
    if (d.investigation_directions?.length) {
      fmt.info(`Investigation directions: ${d.investigation_directions.length}`);
    }
  }

  // Clean up scripts directory unless --keep-scripts
  if (!keepScripts) {
    try {
      const files = fs.readdirSync(scriptsDir);
      for (const f of files) {
        fs.unlinkSync(path.join(scriptsDir, f));
      }
      fs.rmdirSync(scriptsDir);
      fmt.info('Cleaned up .majlis/scripts/');
    } catch { /* ignore cleanup failures */ }
  } else {
    fmt.info('Scripts preserved in .majlis/scripts/ (--keep-scripts)');
  }

  if (result.truncated) {
    fmt.warn('Diagnostician was truncated (hit 60 turn limit).');
  }

  autoCommit(root, `diagnosis: ${focus || 'general'}`);
  fmt.success('Diagnosis complete.');
}
