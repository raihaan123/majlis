import * as fs from 'node:fs';
import * as path from 'node:path';
import type { MajlisConfig } from '../types.js';
import type { ProjectProfile } from './surface.js';

/**
 * Placeholder values that should be overwritten by scan results.
 * If the existing config has any of these, the scan value takes precedence.
 */
const PLACEHOLDER_METRICS_COMMANDS = [
  '',
  "echo '{\"fixtures\":{}}'",
  'echo \'{"fixtures":{}}\'',
];

function isPlaceholder(value: string | null | undefined): boolean {
  if (!value) return true;
  return PLACEHOLDER_METRICS_COMMANDS.includes(value.trim());
}

/**
 * Merge toolsmith agent output into an existing MajlisConfig.
 * Only overwrites placeholder/empty values — preserves user customization.
 */
export function mergeToolsmithConfig(
  existing: MajlisConfig,
  toolsmithOutput: {
    metrics_command?: string | null;
    build_command?: string | null;
    test_command?: string | null;
    test_framework?: string | null;
    pre_measure?: string | null;
    post_measure?: string | null;
    fixtures?: Record<string, unknown>;
    tracked?: Record<string, { direction: string; target?: number }>;
  },
  profile: ProjectProfile,
): MajlisConfig {
  const merged = JSON.parse(JSON.stringify(existing)) as MajlisConfig;

  // Project identity from surface scan
  if (!merged.project.name) merged.project.name = profile.name;
  if (!merged.project.description) merged.project.description = profile.description;

  // Metrics command — only overwrite if placeholder
  if (isPlaceholder(merged.metrics.command) && toolsmithOutput.metrics_command) {
    merged.metrics.command = toolsmithOutput.metrics_command;
  }

  // Build hooks — only overwrite if empty
  if (!merged.build.pre_measure && toolsmithOutput.pre_measure) {
    merged.build.pre_measure = toolsmithOutput.pre_measure;
  }
  if (!merged.build.post_measure && toolsmithOutput.post_measure) {
    merged.build.post_measure = toolsmithOutput.post_measure;
  }

  // Tracked metrics — merge (don't overwrite existing)
  if (toolsmithOutput.tracked && Object.keys(merged.metrics.tracked).length === 0) {
    merged.metrics.tracked = toolsmithOutput.tracked;
  }

  return merged;
}

/**
 * Write the merged config back to disk.
 */
export function writeConfig(root: string, config: MajlisConfig): void {
  const configPath = path.join(root, '.majlis', 'config.json');
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
}
