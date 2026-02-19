import * as fs from 'node:fs';
import * as path from 'node:path';
import { findProjectRoot } from '../db/connection.js';
import { getDb } from '../db/connection.js';
import {
  listActiveExperiments,
  listAllExperiments,
  exportForCompressor,
  getSessionsSinceCompression,
  recordCompression,
} from '../db/queries.js';
import { spawnAgent } from '../agents/spawn.js';
import { loadConfig, resetConfigCache, readFileOrEmpty } from '../config.js';
import { surfaceScan } from '../scan/surface.js';
import { assessStaleness, printStalenessReport } from '../scan/staleness.js';
import { mergeToolsmithConfig, writeConfig } from '../scan/merge.js';
import { autoCommit } from '../git.js';
import * as fmt from '../output/format.js';

/**
 * `majlis resync [--check] [--force]`
 *
 * Bring Majlis back up to speed after the project evolved without tracking.
 *
 *   Phase 0: Staleness Assessment  (deterministic, <2s)
 *   Phase 1: Deep Re-scan          (cartographer + conditional toolsmith)
 *   Phase 2: Config Merge + Record  (deterministic)
 */
export async function resync(args: string[]): Promise<void> {
  const root = findProjectRoot();
  if (!root) throw new Error('Not in a Majlis project. Run `majlis init` first.');

  const check = args.includes('--check');
  const force = args.includes('--force');

  const db = getDb(root);
  const config = loadConfig(root);

  // ── Phase 0: Staleness Assessment ─────────────────────────────────────────

  fmt.header('Resync');
  fmt.info('Phase 0: Assessing staleness...');

  const profile = surfaceScan(root);
  const report = assessStaleness(db, root, profile, config);

  // Edge case: Majlis never used
  if (report.lastActivitySource === 'never' && report.totalExperiments === 0) {
    fmt.warn('No Majlis activity detected. Run `majlis scan` instead.');
    return;
  }

  // Edge case: active experiments in flight
  if (report.activeExperiments > 0 && !force) {
    fmt.warn(`Found ${report.activeExperiments} active experiment(s). Resync requires clean state.`);
    fmt.info('Use --force to resync anyway.');
    return;
  }

  // --check mode: print report and exit
  if (check) {
    printStalenessReport(report);
    return;
  }

  // Print brief summary
  fmt.info(`  Last activity: ${report.daysSinceActivity} days ago (${report.lastActivitySource})`);
  fmt.info(`  Commits since: ${report.commitsSinceActivity}, files changed: ${report.filesChanged}`);
  if (!report.metricsWorking) {
    fmt.warn(`  Metrics broken: ${report.metricsError ?? 'unknown'}`);
  }
  if (report.configDrift.items.length > 0) {
    for (const item of report.configDrift.items) {
      fmt.info(`  Drift: ${item}`);
    }
  }

  // Check if already up to date
  if (
    report.commitsSinceActivity === 0 &&
    report.configDrift.items.length === 0 &&
    report.metricsWorking &&
    !force
  ) {
    fmt.success('Already up to date. Nothing to resync.');
    return;
  }

  // ── Phase 1: Deep Re-scan ─────────────────────────────────────────────────

  fmt.info('Phase 1: Deep re-scan...');

  // Ensure directories exist
  const synthesisDir = path.join(root, 'docs', 'synthesis');
  const scriptsDir = path.join(root, '.majlis', 'scripts');
  if (!fs.existsSync(synthesisDir)) fs.mkdirSync(synthesisDir, { recursive: true });
  if (!fs.existsSync(scriptsDir)) fs.mkdirSync(scriptsDir, { recursive: true });

  const profileJson = JSON.stringify(profile, null, 2);

  // Read old synthesis and fragility for context
  const oldSynthesis = readFileOrEmpty(path.join(root, 'docs', 'synthesis', 'current.md'));
  const oldFragility = readFileOrEmpty(path.join(root, 'docs', 'synthesis', 'fragility.md'));

  // Get DB export for cartographer context
  const dbExport = exportForCompressor(db);

  // Build staleness summary for prompt
  const stalenessSummary =
    `Last Majlis activity: ${report.daysSinceActivity} days ago (${report.lastActivitySource}).\n` +
    `Commits since: ${report.commitsSinceActivity}. Files changed: ${report.filesChanged}.\n` +
    `Unresolved doubts: ${report.unresolvedDoubts}. Experiments: ${report.totalExperiments} total.`;

  // Cartographer prompt (always runs)
  const cartographerPrompt =
    `## Project Profile (from deterministic surface scan)\n\`\`\`json\n${profileJson}\n\`\`\`\n\n` +
    `## Staleness Summary\n${stalenessSummary}\n\n` +
    `## Old Synthesis (STALE — may reference deleted code or outdated structures)\n` +
    `\`\`\`markdown\n${oldSynthesis}\n\`\`\`\n\n` +
    `## Old Fragility Map (STALE)\n` +
    `\`\`\`markdown\n${oldFragility}\n\`\`\`\n\n` +
    `## DB Export (experiments, decisions, dead-ends)\n${dbExport}\n\n` +
    (report.gitDiffStat ? `## Git Diff Stat (since last activity)\n\`\`\`\n${report.gitDiffStat}\n\`\`\`\n\n` : '') +
    `## Your Task\n` +
    `The project has evolved WITHOUT Majlis tracking the changes. Last activity was ` +
    `${report.daysSinceActivity} days / ${report.commitsSinceActivity} commits ago. ` +
    `The current synthesis is STALE and may reference deleted code or outdated structures.\n\n` +
    `Update docs/synthesis/current.md and docs/synthesis/fragility.md to reflect the CURRENT codebase.\n` +
    `Note what has changed. Cross-reference the old synthesis with current code to identify outdated references.\n` +
    `Preserve knowledge from the DB export (experiments, dead-ends) that is still relevant.\n\n` +
    `${profile.sizeCategory === 'huge' ? 'This is a HUGE codebase. Focus on entry points and the top 5 most-imported modules.\n' : ''}` +
    `You may ONLY write to docs/synthesis/. Start by reading the most important files.`;

  // Build agent promises
  const agentPromises: Array<Promise<unknown>> = [
    spawnAgent('cartographer', { taskPrompt: cartographerPrompt }, root),
  ];

  const spawnToolsmith = report.needsToolsmith;
  if (spawnToolsmith) {
    fmt.info('  Toolsmith needed (metrics or toolchain drift detected).');

    const driftDescription = report.configDrift.items.length > 0
      ? report.configDrift.items.join('. ')
      : report.metricsError ?? 'Metrics command not configured or broken.';

    const toolsmithPrompt =
      `## Project Profile (from deterministic surface scan)\n\`\`\`json\n${profileJson}\n\`\`\`\n\n` +
      `## Current Config\n\`\`\`json\n${JSON.stringify(config, null, 2)}\n\`\`\`\n\n` +
      `## What Drifted\n${driftDescription}\n\n` +
      `## Detected Commands\n` +
      `- Test command: ${profile.testCommand ?? '(none detected)'}\n` +
      `- Build command: ${profile.buildCommand ?? '(none detected)'}\n` +
      `- Test framework: ${profile.testFramework ?? '(none detected)'}\n` +
      `- Build system: ${profile.buildSystem ?? '(none detected)'}\n\n` +
      `## Your Task\n` +
      `The project's toolchain has drifted since Majlis was last active. ` +
      `Verify the current test/build commands and update .majlis/scripts/metrics.sh ` +
      `to work with the current toolchain.\n\n` +
      `1. Verify the detected test/build commands actually work by running them.\n` +
      `2. Create/update .majlis/scripts/metrics.sh that runs tests and outputs valid Majlis JSON to stdout:\n` +
      `   {"fixtures":{"test_suite":{"total":N,"passed":N,"failed":N,"duration_ms":N}}}\n` +
      `3. Redirect all non-JSON output to stderr. The script MUST always produce valid JSON.\n` +
      `4. If tests fail, the wrapper still outputs valid JSON with the fail counts.\n\n` +
      `You may ONLY write to .majlis/scripts/. Output your structured JSON when done.`;

    agentPromises.push(
      spawnAgent('toolsmith', { taskPrompt: toolsmithPrompt }, root),
    );
  } else {
    fmt.info('  Toolsmith not needed (metrics working, no toolchain drift).');
  }

  // Spawn agents in parallel
  const agentLabels = spawnToolsmith
    ? ['cartographer', 'toolsmith'] as const
    : ['cartographer'] as const;

  fmt.info(`  Spawning: ${agentLabels.join(' + ')}...`);

  const results = await Promise.allSettled(agentPromises);

  // ── Process results ─────────────────────────────────────────────────────────

  let cartographerOk = false;
  let toolsmithOk = false;

  const cartographerResult = results[0];
  if (cartographerResult.status === 'fulfilled') {
    const result = cartographerResult.value as Awaited<ReturnType<typeof spawnAgent>>;
    cartographerOk = true;
    if (result.truncated) {
      fmt.warn('Cartographer was truncated (hit turn limit).');
    }
    fmt.success('Cartographer complete.');
  } else {
    fmt.warn(`Cartographer failed: ${cartographerResult.reason}`);
  }

  if (spawnToolsmith && results[1]) {
    const toolsmithResult = results[1];
    if (toolsmithResult.status === 'fulfilled') {
      const result = toolsmithResult.value as Awaited<ReturnType<typeof spawnAgent>>;
      toolsmithOk = true;
      if (result.truncated) {
        fmt.warn('Toolsmith was truncated (hit turn limit).');
      }
      fmt.success('Toolsmith complete.');
    } else {
      fmt.warn(`Toolsmith failed: ${toolsmithResult.reason}`);
    }
  }

  if (!cartographerOk && !toolsmithOk) {
    fmt.warn('All agents failed. Resync incomplete.');
    return;
  }

  // ── Phase 2: Config Merge + Record ────────────────────────────────────────

  fmt.info('Phase 2: Config merge + record...');

  // Merge toolsmith output if available
  if (toolsmithOk && results[1]?.status === 'fulfilled') {
    const toolsmithOutput = (results[1].value as Awaited<ReturnType<typeof spawnAgent>>).structured?.toolsmith;
    if (toolsmithOutput) {
      resetConfigCache();
      const existingConfig = loadConfig(root);
      const mergedConfig = mergeToolsmithConfig(existingConfig, toolsmithOutput, profile);
      writeConfig(root, mergedConfig);
      resetConfigCache();
      fmt.info('Updated .majlis/config.json with resync results.');

      // Verify metrics command works
      if (toolsmithOutput.metrics_command) {
        try {
          const metricsPath = path.join(root, toolsmithOutput.metrics_command);
          if (fs.existsSync(metricsPath)) {
            try { fs.chmodSync(metricsPath, 0o755); } catch { /* ignore */ }
          }
          const { execSync: exec } = await import('node:child_process');
          const output = exec(
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
  } else if (!spawnToolsmith) {
    // Only cartographer ran — update project identity from surface scan
    resetConfigCache();
    const existingConfig = loadConfig(root);
    let updated = false;
    if (!existingConfig.project.name && profile.name) {
      existingConfig.project.name = profile.name;
      updated = true;
    }
    if (!existingConfig.project.description && profile.description) {
      existingConfig.project.description = profile.description;
      updated = true;
    }
    if (updated) {
      writeConfig(root, existingConfig);
      resetConfigCache();
    }
  }

  // Record compression (resync rewrites synthesis)
  if (cartographerOk) {
    const sessionCount = getSessionsSinceCompression(db);
    const newSynthesisPath = path.join(root, 'docs', 'synthesis', 'current.md');
    const newSynthesisSize = fs.existsSync(newSynthesisPath)
      ? fs.statSync(newSynthesisPath).size
      : 0;
    recordCompression(db, sessionCount, report.synthesisSize, newSynthesisSize);
    fmt.info('Recorded compression in DB.');
  }

  // Auto-commit
  autoCommit(root, 'resync: update synthesis for code evolution');

  // ── Summary ─────────────────────────────────────────────────────────────────

  fmt.success('Resync complete.');
  if (cartographerOk) fmt.info('  → docs/synthesis/current.md + fragility.md');
  if (toolsmithOk) fmt.info('  → .majlis/scripts/metrics.sh + .majlis/config.json');
  fmt.info('Run `majlis status` to see project state.');
}
