import * as fs from 'node:fs';
import * as path from 'node:path';
import type { MajlisConfig } from './types.js';

const DEFAULT_CONFIG: MajlisConfig = {
  project: { name: '', description: '', objective: '' },
  metrics: { command: '', fixtures: {}, tracked: {} },
  build: { pre_measure: null, post_measure: null },
  cycle: {
    compression_interval: 5,
    circuit_breaker_threshold: 3,
    require_doubt_before_verify: true,
    require_challenge_before_verify: false,
    auto_baseline_on_new_experiment: true,
  },
  models: {},
};

let _cachedConfig: MajlisConfig | null = null;
let _cachedRoot: string | null = null;

/**
 * Load .majlis/config.json with full defaults. Cached per project root.
 */
export function loadConfig(projectRoot: string): MajlisConfig {
  if (_cachedConfig && _cachedRoot === projectRoot) return _cachedConfig;
  const configPath = path.join(projectRoot, '.majlis', 'config.json');
  if (!fs.existsSync(configPath)) {
    _cachedConfig = { ...DEFAULT_CONFIG };
    _cachedRoot = projectRoot;
    return _cachedConfig;
  }
  const loaded = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  _cachedConfig = {
    ...DEFAULT_CONFIG,
    ...loaded,
    project: { ...DEFAULT_CONFIG.project, ...loaded.project },
    metrics: { ...DEFAULT_CONFIG.metrics, ...loaded.metrics },
    build: { ...DEFAULT_CONFIG.build, ...loaded.build },
    cycle: { ...DEFAULT_CONFIG.cycle, ...loaded.cycle },
  };
  _cachedRoot = projectRoot;
  return _cachedConfig;
}

/** Clear cached config (for testing). */
export function resetConfigCache(): void {
  _cachedConfig = null;
  _cachedRoot = null;
}

/** Read a file, returning empty string if it doesn't exist. */
export function readFileOrEmpty(filePath: string): string {
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return '';
  }
}

/** Extract a flag's value from args array with bounds checking. */
export function getFlagValue(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx < 0 || idx + 1 >= args.length) return undefined;
  return args[idx + 1];
}

/**
 * Context size limits (chars) — safety net only.
 * The compressor is the real mechanism for keeping context small.
 * These limits only fire if compression hasn't run in a long time.
 */
export const CONTEXT_LIMITS = {
  synthesis: 30_000,
  fragility: 15_000,
  experimentDoc: 15_000,
  deadEnds: 15_000,
} as const;

/** Truncate content with a marker if it exceeds the limit. */
export function truncateContext(content: string, limit: number): string {
  if (content.length <= limit) return content;
  return content.slice(0, limit) + '\n[TRUNCATED]';
}

/** Read the most recent diagnosis report, if any exist. */
export function readLatestDiagnosis(projectRoot: string): string {
  const dir = path.join(projectRoot, 'docs', 'diagnosis');
  try {
    const files = fs.readdirSync(dir)
      .filter(f => f.startsWith('diagnosis-') && f.endsWith('.md'))
      .sort()
      .reverse();
    if (files.length === 0) return '';
    return fs.readFileSync(path.join(dir, files[0]), 'utf-8');
  } catch {
    return '';
  }
}
