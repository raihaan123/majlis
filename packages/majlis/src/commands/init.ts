import * as fs from 'node:fs';
import * as path from 'node:path';
import { getDb, closeDb, resetDb } from '../db/connection.js';
import * as fmt from '../output/format.js';
import {
  AGENT_DEFINITIONS,
  SLASH_COMMANDS,
  HOOKS_CONFIG,
  CLAUDE_MD_SECTION,
  DOC_TEMPLATES,
  DOC_DIRS,
  WORKFLOW_MD,
  SYNTHESIS_STARTERS,
  DEFAULT_CONFIG,
  mkdirSafe,
} from '@majlis/shared';

// Re-export for upgrade.ts
export { AGENT_DEFINITIONS, SLASH_COMMANDS, HOOKS_CONFIG, CLAUDE_MD_SECTION };

/** Write file only if it doesn't already exist (idempotent init). */
function writeIfMissing(filePath: string, content: string): void {
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, content);
  }
}

export async function init(_args: string[]): Promise<void> {
  const runScan = _args.includes('--scan');
  const projectRoot = process.cwd();

  fmt.header('Initializing Majlis');

  // Create .majlis/ directory
  const majlisDir = path.join(projectRoot, '.majlis');
  mkdirSafe(majlisDir);
  fmt.info('Created .majlis/');

  // Initialize SQLite DB (triggers migrations)
  resetDb();
  const db = getDb(projectRoot);
  fmt.info('Created SQLite database with schema');
  closeDb();
  resetDb();

  // Write config.json
  const configPath = path.join(majlisDir, 'config.json');
  if (!fs.existsSync(configPath)) {
    // Try to detect project name from package.json
    const config = { ...DEFAULT_CONFIG };
    const pkgPath = path.join(projectRoot, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
        config.project.name = pkg.name ?? '';
        config.project.description = pkg.description ?? '';
      } catch { /* ignore */ }
    }
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    fmt.info('Created .majlis/config.json');
  }

  // Write agent definitions to .majlis/agents/ (writeIfMissing — upgrade handles updates)
  const agentsDir = path.join(majlisDir, 'agents');
  mkdirSafe(agentsDir);
  for (const [name, content] of Object.entries(AGENT_DEFINITIONS)) {
    writeIfMissing(path.join(agentsDir, `${name}.md`), content);
  }
  fmt.info('Created agent definitions in .majlis/agents/');

  // Copy agents to .claude/agents/ for Claude Code discovery (writeIfMissing)
  const claudeAgentsDir = path.join(projectRoot, '.claude', 'agents');
  mkdirSafe(claudeAgentsDir);
  for (const [name, content] of Object.entries(AGENT_DEFINITIONS)) {
    writeIfMissing(path.join(claudeAgentsDir, `${name}.md`), content);
  }
  fmt.info('Copied agent definitions to .claude/agents/');

  // Write slash commands to .claude/commands/
  const commandsDir = path.join(projectRoot, '.claude', 'commands');
  mkdirSafe(commandsDir);
  for (const [name, cmd] of Object.entries(SLASH_COMMANDS)) {
    const content = `---\ndescription: ${cmd.description}\n---\n${cmd.body}\n`;
    fs.writeFileSync(path.join(commandsDir, `${name}.md`), content);
  }
  fmt.info('Created slash commands in .claude/commands/');

  // Write hooks to .claude/settings.json
  const settingsPath = path.join(projectRoot, '.claude', 'settings.json');
  if (fs.existsSync(settingsPath)) {
    // Merge hooks into existing settings
    try {
      const existing = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
      existing.hooks = { ...existing.hooks, ...HOOKS_CONFIG.hooks };
      fs.writeFileSync(settingsPath, JSON.stringify(existing, null, 2));
    } catch {
      fs.writeFileSync(settingsPath, JSON.stringify(HOOKS_CONFIG, null, 2));
    }
  } else {
    fs.writeFileSync(settingsPath, JSON.stringify(HOOKS_CONFIG, null, 2));
  }
  fmt.info('Created hooks in .claude/settings.json');

  // Create docs/ tree with templates
  const docsDir = path.join(projectRoot, 'docs');
  for (const dir of DOC_DIRS) {
    mkdirSafe(path.join(docsDir, dir));
  }

  // Write templates
  for (const [relativePath, content] of Object.entries(DOC_TEMPLATES)) {
    const fullPath = path.join(docsDir, relativePath);
    writeIfMissing(fullPath, content);
  }
  fmt.info('Created docs/ tree with templates');

  // Write synthesis starters
  const synthesisDir = path.join(docsDir, 'synthesis');
  for (const [filename, content] of Object.entries(SYNTHESIS_STARTERS)) {
    writeIfMissing(path.join(synthesisDir, filename), content);
  }

  // Write workflow.md
  const workflowPath = path.join(docsDir, 'workflow.md');
  writeIfMissing(workflowPath, WORKFLOW_MD);
  fmt.info('Created docs/workflow.md');

  // Append Majlis protocol to CLAUDE.md
  const claudeMdPath = path.join(projectRoot, 'CLAUDE.md');
  if (fs.existsSync(claudeMdPath)) {
    const existing = fs.readFileSync(claudeMdPath, 'utf-8');
    if (!existing.includes('## Majlis Protocol')) {
      fs.writeFileSync(claudeMdPath, existing + '\n' + CLAUDE_MD_SECTION);
      fmt.info('Appended Majlis Protocol to existing CLAUDE.md');
    }
  } else {
    fs.writeFileSync(claudeMdPath, `# ${path.basename(projectRoot)}\n${CLAUDE_MD_SECTION}`);
    fmt.info('Created CLAUDE.md with Majlis Protocol');
  }

  // Update .gitignore to exclude SQLite DB files
  const gitignorePath = path.join(projectRoot, '.gitignore');
  const dbEntries = ['.majlis/majlis.db', '.majlis/majlis.db-wal', '.majlis/majlis.db-shm'];
  if (fs.existsSync(gitignorePath)) {
    const existing = fs.readFileSync(gitignorePath, 'utf-8');
    if (!existing.includes('.majlis/majlis.db')) {
      const suffix = existing.endsWith('\n') ? '' : '\n';
      fs.writeFileSync(gitignorePath, existing + suffix + dbEntries.join('\n') + '\n');
      fmt.info('Added .majlis/majlis.db to .gitignore');
    }
  }

  fmt.success('Majlis initialized. Run `majlis status` to see project state.');

  if (runScan) {
    fmt.info('Running project scan...');
    const { scan } = await import('./scan.js');
    await scan([]);
  }
}
