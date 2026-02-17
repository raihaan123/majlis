import * as fs from 'node:fs';
import * as path from 'node:path';
import { findProjectRoot } from '../db/connection.js';
import { AGENT_DEFINITIONS, SLASH_COMMANDS, HOOKS_CONFIG, CLAUDE_MD_SECTION } from './init.js';
import { autoCommit } from '../git.js';
import * as fmt from '../output/format.js';

const VERSION = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf-8'),
).version;

/**
 * `majlis upgrade`
 *
 * Re-sync framework files (agents, slash commands, hooks, CLAUDE.md)
 * from the current CLI version. Preserves user data (config, synthesis,
 * experiments, DB). Reports what changed.
 */
export async function upgrade(_args: string[]): Promise<void> {
  const root = findProjectRoot();
  if (!root) throw new Error('Not in a Majlis project. Run `majlis init` first.');

  fmt.header(`Upgrading to Majlis v${VERSION}`);

  let updated = 0;
  let added = 0;

  // 1. Agent definitions → .majlis/agents/ and .claude/agents/
  const majlisAgentsDir = path.join(root, '.majlis', 'agents');
  const claudeAgentsDir = path.join(root, '.claude', 'agents');
  mkdirSafe(majlisAgentsDir);
  mkdirSafe(claudeAgentsDir);

  for (const [name, content] of Object.entries(AGENT_DEFINITIONS)) {
    const majlisPath = path.join(majlisAgentsDir, `${name}.md`);
    const claudePath = path.join(claudeAgentsDir, `${name}.md`);
    const existed = fs.existsSync(majlisPath);
    const current = existed ? fs.readFileSync(majlisPath, 'utf-8') : '';

    if (current !== content) {
      fs.writeFileSync(majlisPath, content);
      fs.writeFileSync(claudePath, content);
      if (existed) {
        fmt.info(`  Updated agent: ${name}`);
        updated++;
      } else {
        fmt.info(`  Added agent: ${name}`);
        added++;
      }
    }
  }

  // Remove agents that no longer exist in the framework
  try {
    for (const file of fs.readdirSync(majlisAgentsDir)) {
      const name = file.replace('.md', '');
      if (!AGENT_DEFINITIONS[name]) {
        fs.unlinkSync(path.join(majlisAgentsDir, file));
        try { fs.unlinkSync(path.join(claudeAgentsDir, file)); } catch {}
        fmt.info(`  Removed deprecated agent: ${name}`);
        updated++;
      }
    }
  } catch {}

  // 2. Slash commands → .claude/commands/
  const commandsDir = path.join(root, '.claude', 'commands');
  mkdirSafe(commandsDir);

  for (const [name, cmd] of Object.entries(SLASH_COMMANDS)) {
    const cmdPath = path.join(commandsDir, `${name}.md`);
    const content = `---\ndescription: ${cmd.description}\n---\n${cmd.body}\n`;
    const existed = fs.existsSync(cmdPath);
    const current = existed ? fs.readFileSync(cmdPath, 'utf-8') : '';

    if (current !== content) {
      fs.writeFileSync(cmdPath, content);
      if (existed) { updated++; } else { added++; }
      fmt.info(`  ${existed ? 'Updated' : 'Added'} command: /${name}`);
    }
  }

  // 3. Hooks → .claude/settings.json (merge, don't overwrite)
  const settingsPath = path.join(root, '.claude', 'settings.json');
  try {
    if (fs.existsSync(settingsPath)) {
      const existing = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
      const before = JSON.stringify(existing.hooks);
      existing.hooks = { ...existing.hooks, ...HOOKS_CONFIG.hooks };
      if (JSON.stringify(existing.hooks) !== before) {
        fs.writeFileSync(settingsPath, JSON.stringify(existing, null, 2));
        fmt.info('  Updated hooks in .claude/settings.json');
        updated++;
      }
    } else {
      fs.writeFileSync(settingsPath, JSON.stringify(HOOKS_CONFIG, null, 2));
      fmt.info('  Created .claude/settings.json');
      added++;
    }
  } catch {
    fmt.warn('  Could not update .claude/settings.json');
  }

  // 4. Doc directories — create any that are missing
  const docDirs = [
    'inbox', 'experiments', 'decisions', 'classification',
    'doubts', 'challenges', 'verification', 'reframes', 'rihla',
    'synthesis', 'diagnosis',
  ];
  for (const dir of docDirs) {
    const dirPath = path.join(root, 'docs', dir);
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
      fmt.info(`  Added docs/${dir}/`);
      added++;
    }
  }

  // 5. CLAUDE.md — replace the Majlis Protocol section
  const claudeMdPath = path.join(root, 'CLAUDE.md');
  if (fs.existsSync(claudeMdPath)) {
    const existing = fs.readFileSync(claudeMdPath, 'utf-8');
    if (existing.includes('## Majlis Protocol')) {
      // Replace existing section: from "## Majlis Protocol" to next "## " or end
      const replaced = existing.replace(
        /## Majlis Protocol[\s\S]*?(?=\n## [^M]|\n## $|$)/,
        CLAUDE_MD_SECTION.trim(),
      );
      if (replaced !== existing) {
        fs.writeFileSync(claudeMdPath, replaced);
        fmt.info('  Updated Majlis Protocol in CLAUDE.md');
        updated++;
      }
    } else {
      fs.writeFileSync(claudeMdPath, existing + '\n' + CLAUDE_MD_SECTION);
      fmt.info('  Appended Majlis Protocol to CLAUDE.md');
      added++;
    }
  }

  // Summary
  if (updated === 0 && added === 0) {
    fmt.success(`Already up to date (v${VERSION}).`);
  } else {
    autoCommit(root, `upgrade to v${VERSION}`);
    fmt.success(`Upgraded to v${VERSION}: ${updated} updated, ${added} added.`);
  }
}

function mkdirSafe(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}
