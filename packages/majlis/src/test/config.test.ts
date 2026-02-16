import { describe, it, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  loadConfig,
  resetConfigCache,
  readFileOrEmpty,
  getFlagValue,
  truncateContext,
  CONTEXT_LIMITS,
} from '../config.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'majlis-config-test-'));
  resetConfigCache();
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  resetConfigCache();
});

describe('loadConfig', () => {
  it('returns defaults when config file is missing', () => {
    const config = loadConfig(tmpDir);
    assert.equal(config.cycle.compression_interval, 5);
    assert.equal(config.cycle.circuit_breaker_threshold, 3);
    assert.equal(config.cycle.auto_baseline_on_new_experiment, true);
    assert.equal(config.project.name, '');
    assert.equal(config.metrics.command, '');
    assert.deepEqual(config.models, {});
  });

  it('loads and merges with defaults', () => {
    fs.mkdirSync(path.join(tmpDir, '.majlis'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, '.majlis', 'config.json'), JSON.stringify({
      project: { name: 'test-proj' },
      cycle: { circuit_breaker_threshold: 5 },
    }));
    const config = loadConfig(tmpDir);
    assert.equal(config.project.name, 'test-proj');
    assert.equal(config.project.objective, ''); // default preserved
    assert.equal(config.cycle.circuit_breaker_threshold, 5); // overridden
    assert.equal(config.cycle.compression_interval, 5); // default preserved
  });

  it('caches per project root', () => {
    fs.mkdirSync(path.join(tmpDir, '.majlis'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, '.majlis', 'config.json'), JSON.stringify({
      project: { name: 'v1' },
    }));

    const config1 = loadConfig(tmpDir);
    assert.equal(config1.project.name, 'v1');

    // Write new value — should still return cached
    fs.writeFileSync(path.join(tmpDir, '.majlis', 'config.json'), JSON.stringify({
      project: { name: 'v2' },
    }));
    const config2 = loadConfig(tmpDir);
    assert.equal(config2.project.name, 'v1'); // cached

    // Reset cache and reload
    resetConfigCache();
    const config3 = loadConfig(tmpDir);
    assert.equal(config3.project.name, 'v2');
  });
});

describe('readFileOrEmpty', () => {
  it('reads existing file', () => {
    const filePath = path.join(tmpDir, 'test.txt');
    fs.writeFileSync(filePath, 'hello');
    assert.equal(readFileOrEmpty(filePath), 'hello');
  });

  it('returns empty string for missing file', () => {
    assert.equal(readFileOrEmpty(path.join(tmpDir, 'nonexistent.txt')), '');
  });
});

describe('getFlagValue', () => {
  it('returns value after flag', () => {
    assert.equal(getFlagValue(['--level', 'proof', '--json'], '--level'), 'proof');
  });

  it('returns undefined when flag is missing', () => {
    assert.equal(getFlagValue(['--json'], '--level'), undefined);
  });

  it('returns undefined when flag is last arg (no value)', () => {
    assert.equal(getFlagValue(['--json', '--level'], '--level'), undefined);
  });

  it('returns first occurrence', () => {
    assert.equal(getFlagValue(['--level', 'proof', '--level', 'test'], '--level'), 'proof');
  });
});

describe('truncateContext', () => {
  it('returns content unchanged when under limit', () => {
    assert.equal(truncateContext('short', 100), 'short');
  });

  it('truncates and appends marker when over limit', () => {
    const result = truncateContext('a'.repeat(200), 100);
    assert.equal(result.length, 100 + '\n[TRUNCATED]'.length);
    assert.ok(result.endsWith('\n[TRUNCATED]'));
  });

  it('handles exact limit boundary', () => {
    const content = 'a'.repeat(100);
    assert.equal(truncateContext(content, 100), content);
  });
});

describe('CONTEXT_LIMITS', () => {
  it('has expected keys', () => {
    assert.ok(CONTEXT_LIMITS.synthesis > 0);
    assert.ok(CONTEXT_LIMITS.fragility > 0);
    assert.ok(CONTEXT_LIMITS.experimentDoc > 0);
    assert.ok(CONTEXT_LIMITS.deadEnds > 0);
  });
});
