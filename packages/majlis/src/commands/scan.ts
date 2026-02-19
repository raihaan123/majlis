import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import { findProjectRoot } from '../db/connection.js';
import { spawnAgent } from '../agents/spawn.js';
import { loadConfig, resetConfigCache } from '../config.js';
import { surfaceScan } from '../scan/surface.js';
import { mergeToolsmithConfig, writeConfig } from '../scan/merge.js';
import * as fmt from '../output/format.js';

/**
 * `majlis scan [--force]`
 *
 * Multi-phase scan of an existing codebase:
 *   Phase 0: Deterministic surface scan (no agents, <2s)
 *   Phase 1: Parallel deep exploration (cartographer + toolsmith)
 *   Phase 2: Deterministic config merge
 */
export async function scan(args: string[]): Promise<void> {
  const root = findProjectRoot();
  if (!root) throw new Error('Not in a Majlis project. Run `majlis init` first.');

  const force = args.includes('--force');

  // Check if synthesis already has content (unless --force)
  if (!force) {
    const currentPath = path.join(root, 'docs', 'synthesis', 'current.md');
    if (fs.existsSync(currentPath)) {
      const content = fs.readFileSync(currentPath, 'utf-8');
      if (!content.includes('No experiments yet') && content.length > 100) {
        fmt.warn('Synthesis files already have content. Use --force to overwrite.');
        return;
      }
    }
  }

  // ── Phase 0: Surface Scan ─────────────────────────────────────────────────

  fmt.header('Project Scan');
  fmt.info('Phase 0: Surface scan...');

  const profile = surfaceScan(root);

  fmt.info(`  Name: ${profile.name}`);
  fmt.info(`  Language: ${profile.primaryLanguage} (${profile.totalFiles} files, ${profile.sizeCategory})`);
  if (profile.testCommand) fmt.info(`  Test: ${profile.testCommand}`);
  if (profile.buildCommand) fmt.info(`  Build: ${profile.buildCommand}`);
  if (profile.isMonorepo) fmt.info(`  Monorepo: ${profile.workspaces.join(', ')}`);
  if (profile.hasCI) fmt.info(`  CI detected`);

  // ── Phase 1: Parallel Deep Exploration ────────────────────────────────────

  fmt.info('Phase 1: Deep exploration (cartographer + toolsmith in parallel)...');

  // Ensure directories exist
  const synthesisDir = path.join(root, 'docs', 'synthesis');
  const scriptsDir = path.join(root, '.majlis', 'scripts');
  if (!fs.existsSync(synthesisDir)) fs.mkdirSync(synthesisDir, { recursive: true });
  if (!fs.existsSync(scriptsDir)) fs.mkdirSync(scriptsDir, { recursive: true });

  const profileJson = JSON.stringify(profile, null, 2);

  // Cartographer prompt
  const cartographerPrompt =
    `## Project Profile (from deterministic surface scan)\n\`\`\`json\n${profileJson}\n\`\`\`\n\n` +
    `## Your Task\nMap the architecture of this ${profile.sizeCategory} ${profile.primaryLanguage} project.\n` +
    `Write docs/synthesis/current.md with: project identity, architecture, key abstractions, ` +
    `entry points, test coverage, build pipeline.\n` +
    `Write docs/synthesis/fragility.md with: untested areas, single points of failure, ` +
    `dependency risk, tech debt.\n\n` +
    `${profile.sizeCategory === 'huge' ? 'This is a HUGE codebase. Focus on entry points and the top 5 most-imported modules.\n' : ''}` +
    `You may ONLY write to docs/synthesis/. Start by reading the most important files.`;

  // Toolsmith prompt
  const toolsmithPrompt =
    `## Project Profile (from deterministic surface scan)\n\`\`\`json\n${profileJson}\n\`\`\`\n\n` +
    `## Detected Commands\n` +
    `- Test command: ${profile.testCommand ?? '(none detected)'}\n` +
    `- Build command: ${profile.buildCommand ?? '(none detected)'}\n` +
    `- Test framework: ${profile.testFramework ?? '(none detected)'}\n` +
    `- Build system: ${profile.buildSystem ?? '(none detected)'}\n\n` +
    `## Your Task\n` +
    `1. Verify the detected test/build commands actually work by running them.\n` +
    `2. Create .majlis/scripts/metrics.sh that runs tests and outputs valid Majlis JSON to stdout:\n` +
    `   {"fixtures":{"test_suite":{"total":N,"passed":N,"failed":N,"duration_ms":N}}}\n` +
    `3. Redirect all non-JSON output to stderr. The script MUST always produce valid JSON.\n` +
    `4. If tests fail, the wrapper still outputs valid JSON with the fail counts.\n` +
    `5. If no tests exist, create a stub that outputs {"fixtures":{"project":{"has_tests":0}}}\n\n` +
    `You may ONLY write to .majlis/scripts/. Output your structured JSON when done.`;

  // Spawn both agents in parallel
  const [cartographerResult, toolsmithResult] = await Promise.allSettled([
    spawnAgent('cartographer', { taskPrompt: cartographerPrompt }, root),
    spawnAgent('toolsmith', { taskPrompt: toolsmithPrompt }, root),
  ]);

  // ── Process results ───────────────────────────────────────────────────────

  let cartographerOk = false;
  let toolsmithOk = false;

  if (cartographerResult.status === 'fulfilled') {
    const result = cartographerResult.value;
    cartographerOk = true;
    if (result.truncated) {
      fmt.warn('Cartographer was truncated (hit 40 turn limit).');
    }
    if (result.structured?.architecture) {
      const arch = result.structured.architecture;
      fmt.info(`  Modules: ${arch.modules?.length ?? 0}`);
      fmt.info(`  Entry points: ${arch.entry_points?.length ?? 0}`);
    }
    fmt.success('Cartographer complete.');
  } else {
    fmt.warn(`Cartographer failed: ${cartographerResult.reason}`);
  }

  if (toolsmithResult.status === 'fulfilled') {
    const result = toolsmithResult.value;
    toolsmithOk = true;
    if (result.truncated) {
      fmt.warn('Toolsmith was truncated (hit 30 turn limit).');
    }
    if (result.structured?.toolsmith) {
      const ts = result.structured.toolsmith;
      if (ts.issues?.length) {
        for (const issue of ts.issues) {
          fmt.warn(`  Issue: ${issue}`);
        }
      }
    }
    fmt.success('Toolsmith complete.');
  } else {
    fmt.warn(`Toolsmith failed: ${toolsmithResult.reason}`);
  }

  if (!cartographerOk && !toolsmithOk) {
    fmt.warn('Both agents failed. Scan incomplete.');
    return;
  }

  // ── Phase 2: Deterministic Config Merge ───────────────────────────────────

  fmt.info('Phase 2: Config merge...');

  if (toolsmithOk && toolsmithResult.status === 'fulfilled') {
    const toolsmithOutput = toolsmithResult.value.structured?.toolsmith;
    if (toolsmithOutput) {
      resetConfigCache();
      const existingConfig = loadConfig(root);
      const mergedConfig = mergeToolsmithConfig(existingConfig, toolsmithOutput, profile);
      writeConfig(root, mergedConfig);
      resetConfigCache();
      fmt.info('Updated .majlis/config.json with scan results.');

      // Verify metrics command works
      if (toolsmithOutput.metrics_command) {
        try {
          const metricsPath = path.join(root, toolsmithOutput.metrics_command);
          if (fs.existsSync(metricsPath)) {
            // Make sure it's executable
            try { fs.chmodSync(metricsPath, 0o755); } catch { /* ignore */ }
          }
          const output = execSync(
            toolsmithOutput.metrics_command,
            { cwd: root, encoding: 'utf-8', timeout: 60_000, stdio: ['pipe', 'pipe', 'pipe'] },
          ).trim();
          JSON.parse(output); // Validate JSON
          fmt.success('Metrics command verified — produces valid JSON.');
        } catch {
          fmt.warn('Metrics command did not produce valid JSON. May need manual adjustment.');
        }
      }
    } else {
      fmt.warn('Toolsmith produced no structured output. Config not updated.');
    }
  }

  // ── Auto-commit ───────────────────────────────────────────────────────────

  autoCommitScan(root);

  fmt.success('Scan complete.');
  if (cartographerOk) fmt.info('  → docs/synthesis/current.md + fragility.md');
  if (toolsmithOk) fmt.info('  → .majlis/scripts/metrics.sh + .majlis/config.json');
  fmt.info('Run `majlis status` to see project state.');
}

/**
 * Auto-commit scan artifacts: docs/synthesis/, .majlis/scripts/, .majlis/config.json.
 */
function autoCommitScan(root: string): void {
  try {
    execSync(
      'git add docs/synthesis/ .majlis/scripts/ .majlis/config.json 2>/dev/null; true',
      { cwd: root, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
    );

    const diff = execSync('git diff --cached --stat', {
      cwd: root, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();

    if (!diff) return;

    execSync('git commit -m "[majlis] scan: auto-detect project configuration"', {
      cwd: root, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
    });
    fmt.info('Auto-committed scan artifacts.');
  } catch {
    // Non-fatal
  }
}
