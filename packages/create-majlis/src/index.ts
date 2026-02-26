#!/usr/bin/env node

import * as fs from 'node:fs';
import * as path from 'node:path';
import { runPrompts, defaultAnswers } from './prompts.js';
import { scaffold } from './scaffold.js';

const VERSION = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf-8'),
).version;

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  // Flags
  const hasFlag = (flag: string): boolean => args.includes(flag);
  const isInit = hasFlag('--init');
  const noHooks = hasFlag('--no-hooks');
  const minimal = hasFlag('--minimal');
  const yes = hasFlag('--yes') || hasFlag('-y');

  if (hasFlag('--version') || hasFlag('-v')) {
    console.log(VERSION);
    process.exit(0);
  }

  if (hasFlag('--help') || hasFlag('-h')) {
    printHelp();
    process.exit(0);
  }

  // Positional arg = project name/path (exclude flags)
  const positional = args.filter(a => !a.startsWith('-'));
  const projectArg = positional[0];

  if (isInit) {
    // --init mode: add Majlis to existing project
    const targetDir = projectArg || '.';
    const answers = yes
      ? defaultAnswers(targetDir === '.' ? currentDirName() : targetDir)
      : await runPrompts(targetDir === '.' ? currentDirName() : targetDir);

    console.log('\n\x1b[1mAdding Majlis to existing project...\x1b[0m\n');
    scaffold({ targetDir, answers, fresh: false, noHooks, minimal });
  } else if (projectArg) {
    // Fresh project mode
    const answers = yes
      ? defaultAnswers(projectArg)
      : await runPrompts(projectArg);

    console.log('\n\x1b[1mCreating new Majlis project...\x1b[0m\n');
    scaffold({ targetDir: projectArg, answers, fresh: true, noHooks, minimal });
  } else {
    // No argument: init in current directory
    const answers = yes
      ? defaultAnswers(currentDirName())
      : await runPrompts(currentDirName());

    console.log('\n\x1b[1mAdding Majlis to current directory...\x1b[0m\n');
    scaffold({ targetDir: '.', answers, fresh: false, noHooks, minimal });
  }
}

function currentDirName(): string {
  return process.cwd().split('/').pop() || 'project';
}

function printHelp(): void {
  console.log(`
\x1b[1mcreate-majlis\x1b[0m v${VERSION} — Scaffold the Majlis Framework

\x1b[1mUsage:\x1b[0m
  npx create-majlis <project-name>    Create a new project with Majlis
  npx create-majlis --init            Add Majlis to existing project
  npx create-majlis                   Add Majlis to current directory

\x1b[1mFlags:\x1b[0m
  --init           Add to existing project (don't create new dir)
  --yes, -y        Accept defaults (non-interactive)
  --no-hooks       Skip Claude Code hooks setup
  --minimal        Only include builder, critic, verifier, compressor
  --version, -v    Print version
  --help, -h       Print help

\x1b[1mExamples:\x1b[0m
  npx create-majlis my-research
  npx create-majlis --init --minimal
  npx create-majlis my-project --yes --no-hooks
`);
}

main().catch((err) => {
  console.error(`\x1b[31mError: ${err instanceof Error ? err.message : String(err)}\x1b[0m`);
  process.exit(1);
});
