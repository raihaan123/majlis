import { describe, it, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CLI_PATH = path.resolve(__dirname, '..', '..', 'dist', 'cli.js');
let tmpDir: string;

function run(cmd: string): string {
  return execSync(`node ${CLI_PATH} ${cmd}`, {
    cwd: tmpDir,
    encoding: 'utf-8',
    env: { ...process.env, PATH: process.env.PATH },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

function runExpectFail(cmd: string): { stderr: string } {
  try {
    execSync(`node ${CLI_PATH} ${cmd}`, {
      cwd: tmpDir,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    assert.fail('Expected command to fail');
  } catch (err: any) {
    return { stderr: err.stderr ?? '' };
  }
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'majlis-test-'));
  // Initialize a git repo so commands work
  execSync('git init', { cwd: tmpDir, stdio: 'pipe' });
  execSync('git commit --allow-empty -m "init"', { cwd: tmpDir, stdio: 'pipe' });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('majlis --version', () => {
  it('prints version', () => {
    const output = run('--version');
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf-8'));
    assert.equal(output.trim(), pkg.version);
  });
});

describe('majlis init', () => {
  it('creates .majlis directory', () => {
    run('init');
    assert.ok(fs.existsSync(path.join(tmpDir, '.majlis')));
  });

  it('creates SQLite database', () => {
    run('init');
    assert.ok(fs.existsSync(path.join(tmpDir, '.majlis', 'majlis.db')));
  });

  it('creates config.json', () => {
    run('init');
    assert.ok(fs.existsSync(path.join(tmpDir, '.majlis', 'config.json')));
    const config = JSON.parse(fs.readFileSync(path.join(tmpDir, '.majlis', 'config.json'), 'utf-8'));
    assert.ok(config.cycle);
    assert.equal(config.cycle.circuit_breaker_threshold, 3);
  });

  it('creates agent definitions', () => {
    run('init');
    const agents = ['builder', 'critic', 'adversary', 'verifier', 'reframer', 'compressor', 'scout', 'gatekeeper'];
    for (const agent of agents) {
      assert.ok(
        fs.existsSync(path.join(tmpDir, '.majlis', 'agents', `${agent}.md`)),
        `Missing agent: ${agent}`,
      );
    }
  });

  it('creates .claude/agents/ copies', () => {
    run('init');
    assert.ok(fs.existsSync(path.join(tmpDir, '.claude', 'agents', 'builder.md')));
  });

  it('creates slash commands', () => {
    run('init');
    const commands = ['classify', 'doubt', 'challenge', 'verify', 'reframe', 'compress', 'scout', 'audit'];
    for (const cmd of commands) {
      assert.ok(
        fs.existsSync(path.join(tmpDir, '.claude', 'commands', `${cmd}.md`)),
        `Missing command: ${cmd}`,
      );
    }
  });

  it('creates hooks in settings.json', () => {
    run('init');
    const settings = JSON.parse(fs.readFileSync(path.join(tmpDir, '.claude', 'settings.json'), 'utf-8'));
    assert.ok(settings.hooks);
    assert.ok(settings.hooks.SessionStart);
    assert.ok(settings.hooks.PreToolUse);
  });

  it('creates docs tree', () => {
    run('init');
    const dirs = ['experiments', 'decisions', 'classification', 'doubts', 'challenges', 'verification', 'reframes', 'rihla', 'synthesis'];
    for (const dir of dirs) {
      assert.ok(
        fs.existsSync(path.join(tmpDir, 'docs', dir)),
        `Missing dir: docs/${dir}`,
      );
    }
  });

  it('creates document templates', () => {
    run('init');
    assert.ok(fs.existsSync(path.join(tmpDir, 'docs', 'experiments', '_TEMPLATE.md')));
    assert.ok(fs.existsSync(path.join(tmpDir, 'docs', 'doubts', '_TEMPLATE.md')));
    assert.ok(fs.existsSync(path.join(tmpDir, 'docs', 'verification', '_TEMPLATE.md')));
  });

  it('creates synthesis starters', () => {
    run('init');
    assert.ok(fs.existsSync(path.join(tmpDir, 'docs', 'synthesis', 'current.md')));
    assert.ok(fs.existsSync(path.join(tmpDir, 'docs', 'synthesis', 'fragility.md')));
    assert.ok(fs.existsSync(path.join(tmpDir, 'docs', 'synthesis', 'dead-ends.md')));
  });

  it('creates CLAUDE.md', () => {
    run('init');
    assert.ok(fs.existsSync(path.join(tmpDir, 'CLAUDE.md')));
    const content = fs.readFileSync(path.join(tmpDir, 'CLAUDE.md'), 'utf-8');
    assert.ok(content.includes('Majlis Protocol'));
    assert.ok(content.includes('Evidence Hierarchy'));
  });

  it('creates workflow.md', () => {
    run('init');
    assert.ok(fs.existsSync(path.join(tmpDir, 'docs', 'workflow.md')));
  });
});

describe('majlis status', () => {
  it('shows status after init', () => {
    run('init');
    const output = run('status');
    assert.ok(output.includes('No active experiments'));
  });

  it('outputs JSON', () => {
    run('init');
    const output = run('status --json');
    const data = JSON.parse(output);
    assert.ok(Array.isArray(data.experiments));
    assert.equal(data.experiments.length, 0);
  });
});

describe('majlis new', () => {
  it('creates an experiment', () => {
    run('init');
    const output = run('new "Test hypothesis for seam handling"');
    assert.ok(output.includes('Created experiment'));
  });

  it('shows experiment in status', () => {
    run('init');
    run('new "Test hypothesis"');
    const output = run('status --json');
    const data = JSON.parse(output);
    assert.equal(data.experiments.length, 1);
    assert.equal(data.experiments[0].status, 'classified');
  });

  it('creates experiment log', () => {
    run('init');
    run('new "Test hypothesis"');
    const files = fs.readdirSync(path.join(tmpDir, 'docs', 'experiments'))
      .filter(f => !f.startsWith('_'));
    assert.equal(files.length, 1);
  });
});

describe('majlis session', () => {
  it('starts and ends a session', () => {
    run('init');
    const startOutput = run('session start "Fix degenerate faces"');
    assert.ok(startOutput.includes('Session started'));

    const statusJson = JSON.parse(run('status --json'));
    assert.ok(statusJson.active_session);

    const endOutput = run('session end --accomplished "Done" --unfinished "None"');
    assert.ok(endOutput.includes('Session ended'));
  });

  it('prevents double session start', () => {
    run('init');
    run('session start "First"');
    const output = run('session start "Second"');
    assert.ok(output.includes('already active'));
  });
});

describe('majlis decisions', () => {
  it('shows empty decisions', () => {
    run('init');
    const output = run('decisions');
    assert.ok(output.includes('No decisions'));
  });
});

describe('majlis circuit-breakers', () => {
  it('shows empty state', () => {
    run('init');
    const output = run('circuit-breakers');
    assert.ok(output.includes('No circuit breaker'));
  });
});

describe('full manual workflow', () => {
  it('init → session → new → status', () => {
    run('init');
    run('session start "Test the framework"');
    run('new "Test hypothesis"');
    const output = run('status --json');
    const data = JSON.parse(output);
    assert.equal(data.experiments.length, 1);
    assert.ok(data.active_session);
    run('session end');
  });
});
