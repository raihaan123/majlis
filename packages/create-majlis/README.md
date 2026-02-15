# create-majlis

Scaffold the [Majlis Framework](../../README.md) into a project.

## Usage

### New project

```bash
npx create-majlis my-project
```

### Existing project

```bash
npx create-majlis --init
```

### Options

```
npx create-majlis [directory] [options]

Options:
  --init       Add Majlis to an existing project (don't create directory)
  --yes, -y    Accept defaults (skip prompts)
  --no-hooks   Skip hooks configuration
  --minimal    Core roles only (builder, critic, verifier, compressor)
```

## What it creates

- `.majlis/` — Config, agent definitions, SQLite database
- `.claude/` — Agents, slash commands, hooks for Claude Code
- `docs/` — Templates for experiments, doubts, challenges, verification, synthesis

## License

MIT
