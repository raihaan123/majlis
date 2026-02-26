import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import type { ProjectAnswers } from './prompts.js';
import {
  AGENT_DEFINITIONS,
  SLASH_COMMANDS,
  HOOKS_CONFIG,
  DOC_TEMPLATES,
  DOC_DIRS,
  WORKFLOW_MD,
  SYNTHESIS_STARTERS,
  claudeMdContent,
  configTemplate,
  mkdirSafe,
} from '@majlis/shared';
import type { ConfigTemplateAnswers } from '@majlis/shared';

// ─── Options ───────────────────────────────────────────────────────────────────
export interface ScaffoldOptions {
  targetDir: string;
  answers: ProjectAnswers;
  fresh: boolean;          // true = new project, false = --init existing
  noHooks: boolean;        // --no-hooks
  minimal: boolean;        // --minimal (skip adversary, reframer)
}

// ─── Main scaffold function ────────────────────────────────────────────────────
export function scaffold(opts: ScaffoldOptions): void {
  const { targetDir, answers, fresh, noHooks, minimal } = opts;

  if (fresh) {
    scaffoldFresh(targetDir, answers, noHooks, minimal);
  } else {
    scaffoldInit(targetDir, answers, noHooks, minimal);
  }
}

function scaffoldFresh(
  targetDir: string,
  answers: ProjectAnswers,
  noHooks: boolean,
  minimal: boolean,
): void {
  const p = path.resolve(targetDir);

  // Create project directory
  if (fs.existsSync(p)) {
    throw new Error(`Directory already exists: ${p}`);
  }
  fs.mkdirSync(p, { recursive: true });
  console.log(`  Created ${p}`);

  // git init
  execSync('git init', { cwd: p, stdio: 'pipe' });
  execSync('git commit --allow-empty -m "Initial commit"', { cwd: p, stdio: 'pipe' });
  console.log('  Initialized git repository');

  // Write package.json
  const pkg = {
    name: answers.name || path.basename(p),
    version: '0.0.1',
    description: answers.description,
    private: true,
    scripts: {
      test: 'echo "Error: no test specified" && exit 1',
    },
    devDependencies: {} as Record<string, string>,
  };
  fs.writeFileSync(path.join(p, 'package.json'), JSON.stringify(pkg, null, 2));
  console.log('  Created package.json');

  // Write .gitignore
  fs.writeFileSync(path.join(p, '.gitignore'), [
    'node_modules/',
    'dist/',
    '*.db',
    '.majlis/majlis.db',
    '.DS_Store',
    '',
  ].join('\n'));
  console.log('  Created .gitignore');

  // Scaffold all Majlis files
  scaffoldMajlisFiles(p, answers, noHooks, minimal);

  // Install majlis as dev dependency
  try {
    execSync('npm install --save-dev majlis', { cwd: p, stdio: 'pipe', timeout: 60000 });
    console.log('  Installed majlis as dev dependency');
  } catch {
    console.log('  \x1b[33mNote: Could not install majlis package. Install manually: npm install --save-dev majlis\x1b[0m');
  }

  // Try running majlis init to set up the database
  try {
    execSync('npx majlis init', { cwd: p, stdio: 'pipe', timeout: 30000 });
    console.log('  Ran majlis init (database created)');
  } catch {
    console.log('  \x1b[33mNote: Could not run majlis init. Run it manually after installing.\x1b[0m');
  }

  console.log(`\n\x1b[32m\x1b[1mDone!\x1b[0m Project created at ${p}`);
  console.log(`\n  cd ${targetDir}`);
  console.log('  majlis scan              # auto-detect project configuration');
  console.log('  majlis status');
  console.log('  majlis session start "First session"');
  console.log('  majlis new "First hypothesis"\n');
}

function scaffoldInit(
  targetDir: string,
  answers: ProjectAnswers,
  noHooks: boolean,
  minimal: boolean,
): void {
  const p = path.resolve(targetDir);

  if (!fs.existsSync(p)) {
    throw new Error(`Directory does not exist: ${p}`);
  }

  // Check for git
  const gitDir = path.join(p, '.git');
  if (!fs.existsSync(gitDir)) {
    console.log('  \x1b[33mWarning: No git repository found. Initializing...\x1b[0m');
    execSync('git init', { cwd: p, stdio: 'pipe' });
    execSync('git commit --allow-empty -m "Initial commit"', { cwd: p, stdio: 'pipe' });
  }

  // Scaffold Majlis files (without clobbering)
  scaffoldMajlisFiles(p, answers, noHooks, minimal);

  // Try running majlis init for database
  try {
    execSync('npx majlis init', { cwd: p, stdio: 'pipe', timeout: 30000 });
    console.log('  Ran majlis init (database created)');
  } catch {
    console.log('  \x1b[33mNote: Could not run majlis init. Install majlis and run it manually.\x1b[0m');
  }

  console.log(`\n\x1b[32m\x1b[1mDone!\x1b[0m Majlis added to ${p}`);
  console.log('\n  majlis scan              # auto-detect project configuration');
  console.log('  majlis status');
  console.log('  majlis session start "First session"\n');
}

// ─── Shared scaffolding logic ──────────────────────────────────────────────────
function scaffoldMajlisFiles(
  projectRoot: string,
  answers: ProjectAnswers,
  noHooks: boolean,
  minimal: boolean,
): void {
  // Determine which agents to include
  const agentNames = minimal
    ? ['builder', 'critic', 'verifier', 'compressor', 'gatekeeper', 'diagnostician', 'cartographer', 'toolsmith']
    : ['builder', 'critic', 'adversary', 'verifier', 'reframer', 'compressor', 'scout', 'gatekeeper', 'diagnostician', 'cartographer', 'toolsmith'];

  // .majlis/ directory
  const majlisDir = path.join(projectRoot, '.majlis');
  mkdirSafe(majlisDir);

  // Config
  const configPath = path.join(majlisDir, 'config.json');
  writeIfMissing(configPath, configTemplate(answers as ConfigTemplateAnswers));
  console.log('  Created .majlis/config.json');

  // Agent definitions in .majlis/agents/
  const agentsDir = path.join(majlisDir, 'agents');
  mkdirSafe(agentsDir);
  for (const name of agentNames) {
    fs.writeFileSync(path.join(agentsDir, `${name}.md`), AGENT_DEFINITIONS[name]);
  }
  console.log(`  Created ${agentNames.length} agent definitions in .majlis/agents/`);

  // Copy agents to .claude/agents/
  const claudeAgentsDir = path.join(projectRoot, '.claude', 'agents');
  mkdirSafe(claudeAgentsDir);
  for (const name of agentNames) {
    fs.writeFileSync(path.join(claudeAgentsDir, `${name}.md`), AGENT_DEFINITIONS[name]);
  }
  console.log('  Copied agents to .claude/agents/');

  // Slash commands in .claude/commands/
  const commandsDir = path.join(projectRoot, '.claude', 'commands');
  mkdirSafe(commandsDir);
  for (const [name, cmd] of Object.entries(SLASH_COMMANDS)) {
    // Skip adversary/reframer commands in minimal mode
    if (minimal && (name === 'challenge' || name === 'reframe')) continue;
    const content = `---\ndescription: ${cmd.description}\n---\n${cmd.body}\n`;
    fs.writeFileSync(path.join(commandsDir, `${name}.md`), content);
  }
  console.log('  Created slash commands in .claude/commands/');

  // Hooks in .claude/settings.json
  if (!noHooks) {
    const settingsPath = path.join(projectRoot, '.claude', 'settings.json');
    if (fs.existsSync(settingsPath)) {
      try {
        const existing = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
        existing.hooks = { ...existing.hooks, ...HOOKS_CONFIG.hooks };
        fs.writeFileSync(settingsPath, JSON.stringify(existing, null, 2));
      } catch {
        fs.writeFileSync(settingsPath, JSON.stringify(HOOKS_CONFIG, null, 2));
      }
    } else {
      mkdirSafe(path.join(projectRoot, '.claude'));
      fs.writeFileSync(settingsPath, JSON.stringify(HOOKS_CONFIG, null, 2));
    }
    console.log('  Created hooks in .claude/settings.json');
  }

  // docs/ tree
  const docsDir = path.join(projectRoot, 'docs');
  for (const dir of DOC_DIRS) {
    mkdirSafe(path.join(docsDir, dir));
  }

  // Document templates
  for (const [relativePath, content] of Object.entries(DOC_TEMPLATES)) {
    const fullPath = path.join(docsDir, relativePath);
    writeIfMissing(fullPath, content);
  }
  console.log('  Created docs/ tree with templates');

  // Synthesis starters
  const synthesisDir = path.join(docsDir, 'synthesis');
  for (const [filename, content] of Object.entries(SYNTHESIS_STARTERS)) {
    writeIfMissing(path.join(synthesisDir, filename), content);
  }

  // Workflow reference
  writeIfMissing(path.join(docsDir, 'workflow.md'), WORKFLOW_MD);
  console.log('  Created docs/workflow.md');

  // CLAUDE.md
  const claudeMdPath = path.join(projectRoot, 'CLAUDE.md');
  if (fs.existsSync(claudeMdPath)) {
    const existing = fs.readFileSync(claudeMdPath, 'utf-8');
    if (!existing.includes('## Majlis Protocol')) {
      fs.writeFileSync(claudeMdPath, existing + '\n' + claudeMdContent(answers.name, answers.objective));
      console.log('  Appended Majlis Protocol to existing CLAUDE.md');
    }
  } else {
    fs.writeFileSync(claudeMdPath, claudeMdContent(answers.name || path.basename(projectRoot), answers.objective));
    console.log('  Created CLAUDE.md');
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────────────
function writeIfMissing(filePath: string, content: string): void {
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, content);
  }
}
