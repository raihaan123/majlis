# Majlis Framework — Development Instructions

## What This Is
A multi-agent workflow CLI for Claude Code that enforces structured doubt, independent verification, and compressed knowledge. Two npm packages in a monorepo.

## Architecture
- `packages/majlis` — The CLI. Deterministic state machine, SQLite persistence, agent spawning.
- `packages/create-majlis` — NPX scaffolder that bootstraps Majlis into a project.

## Tech Stack
- **Runtime deps:** better-sqlite3 only. Everything else is Node built-ins or dev-only.
- **Build:** tsup (zero-config TS bundler → single CJS bundle)
- **Test:** node:test + node:assert (Node 24 built-in, zero deps)
- **CLI parsing:** Raw process.argv (flat command set)
- **Output formatting:** Raw ANSI codes (no chalk)
- **Templates:** String.replace with `{{var}}` (no engine dependency)

## Build & Test
```bash
npm install          # from root
npm run build        # builds both packages
npm test             # runs tests in both packages
```

## Key Patterns
- **State machine is deterministic.** No LLM in state transitions. See `src/state/`.
- **SQLite is the source of truth.** All experiment state, decisions, metrics in `.majlis/majlis.db`.
- **Agents are spawned via `claude --print`.** See `src/agents/spawn.ts`.
- **3-tier output parsing:** JSON block → regex → Haiku fallback. See `src/agents/parse.ts`.
- **Every decision is tagged** with evidence level (proof/test/strong_consensus/consensus/analogy/judgment).

## Canonical Reference
- PRD: See `FOUNDATIONS.md` for intellectual principles.
- PRD v2: The authoritative specification is the plan document.

## File Conventions
- All SQL in `src/db/queries.ts` as named prepared statements.
- All state transitions in `src/state/machine.ts`.
- All agent definitions read from `.majlis/agents/*.md` (YAML frontmatter + markdown).
- Templates use `{{placeholder}}` syntax.
