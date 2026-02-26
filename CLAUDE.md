# Majlis Framework — Development Instructions

## What This Is
A multi-agent workflow CLI for Claude Code that enforces structured doubt, independent verification, and compressed knowledge. Three npm packages in a monorepo.

## Architecture
- `packages/majlis` — The CLI. Deterministic state machine, SQLite persistence, agent spawning.
- `packages/create-majlis` — NPX scaffolder that bootstraps Majlis into a project.
- `packages/shared` — Internal package (`@majlis/shared`). Agent definitions, templates, config defaults, hook/command generators. Bundled into consumer packages via tsup (not published separately).

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
npm run build        # builds shared → majlis → create-majlis (order matters)
npm test             # runs tests in both consumer packages
```

## Key Patterns
- **State machine is deterministic.** No LLM in state transitions. See `src/state/`.
- **Two transition paths:** `transition()` for normal flow (validated against TRANSITIONS map), `adminTransition()` for operational moves (revert, circuit breaker, error recovery — validated against ADMIN_TRANSITIONS).
- **SQLite is the source of truth.** All experiment state, decisions, metrics in `.majlis/majlis.db`.
- **Agents are spawned via `claude --print`.** See `src/agents/spawn.ts`.
- **3-tier output parsing:** JSON block → regex → Haiku fallback. See `src/agents/parse.ts`.
- **Every decision is tagged** with evidence level (proof/test/strong_consensus/consensus/analogy/judgment).
- **Shell commands use `execFileSync`** (not `execSync`) — no shell interpolation, arguments passed as arrays.
- **Shared package is bundled, not external.** Both consumer tsup configs inline `@majlis/shared` into their dist bundles. The shared package is `private: true` and never published.

## Canonical Reference
- PRD: See `FOUNDATIONS.md` for intellectual principles.
- PRD v2: The authoritative specification is the plan document.

## File Conventions
- All SQL in `src/db/queries.ts` as named prepared statements.
- All state transitions in `src/state/machine.ts`.
- All agent definitions read from `.majlis/agents/*.md` (YAML frontmatter + markdown).
- Templates use `{{placeholder}}` syntax.

## Release Pattern
```bash
# 1. Bump version in all three package.json files (majlis, create-majlis, shared)
# 2. Commit with message format: "Majlis vX.Y.Z — brief description"
# 3. Tag with: git tag vX.Y.Z
# 4. Push commit and tag: git push && git push --tags
# CI on GitHub handles npm publish from the tag.
```
- All three packages share the same version number.
- `@majlis/shared` is `private: true` — CI skips it during publish.
- Commit message convention: `Majlis vX.Y.Z — feature/fix summary`.
