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

## Experiment Features
- **Regression gates:** `config.metrics.fixtures` is a `Record<string, { gate?: boolean }>`. Gate fixtures block merge on regression regardless of verification grades (Tradition 3: jarh wa ta'dil).
- **Experiment dependencies:** `majlis new --depends-on SLUG` blocks building until the dependency is merged (Tradition 4: Al-Khwarizmi's ordering).
- **Scoped context:** `majlis new --context file1,file2` injects domain-specific docs into agent prompts (Tradition 13: Ijtihad prerequisite mastery).
- **Structured metric comparison:** Verifier receives typed `MetricComparison[]` with regression flags and gate markers (Tradition 15: Tajwid precision).
- **Project readiness:** `majlis status` runs diagnostic checks on config, fixtures, metrics, and docs.
- **Build verification gate:** If `config.build.pre_measure` is set, runs after builder finishes — broken code stays at 'building' with guidance for retry. Skips if unconfigured (Tradition 3: weak link invalidates chain).
- **Builder abandon:** Builder can abandon a hypothesis it determines is structurally impossible, outputting `{ "abandon": { "reason": "...", "structural_constraint": "..." } }`. Records dead-end and skips the full cycle (Tradition 13: Ijtihad qualified judgment).
- **Gate rejection pause:** Gatekeeper rejection stores the reason in `gate_rejection_reason` and the experiment stays at 'gated'. User can dispute with `majlis next --override-gate` or abandon with `majlis revert`. Autonomous mode (`majlis run`) auto-dead-ends since no human to dispute.
- **Post-mortem agent:** `majlis revert` spawns a read-only opus agent that analyses the git diff, synthesis, and artifact files to produce structured dead-end constraints. Falls back to `--reason` text on failure.
- **Experiment lineage:** Builder and verifier receive structured DB records for related experiments (same sub-type). Injected as canonical context alongside synthesis (Tradition 1: Hafiz, Tradition 14: Shura — genuine consultation).
- **Output provenance tracking:** `extractStructuredData` returns `{ data, tier }` — tier 1 (JSON), 2 (regex), 3 (Haiku). Tier 3 triggers a provenance warning to the verifier (Tradition 3: chain provenance, Tradition 15: Tajwid distortion flagging).
- **Extended write guards:** Builder and verifier are blocked from modifying `.claude/` and `.majlis/agents/` directories (Tradition 12: Adab al-Bahth — agents must not modify their own instructions).
- **Swarm rebase on conflict:** Merge conflicts trigger rebase + gate re-verification. If gates hold, fast-forward merge; if violated, manual intervention required (Tradition 9: 'Ilm al-Ikhtilaf — factual disagreement resolved mechanically).
- **Truncation recovery via extraction:** When a builder is truncated (hits max turns), the framework runs `extractStructuredData` on the full truncated output instead of spawning a separate recovery agent. If a `<!-- majlis-json -->` block is found, the build proceeds normally; otherwise, the tail of the output is stored as guidance and the experiment stays at `building` (Tradition 3: use the strongest available chain, not a weaker intermediary).
- **Intra-experiment constraint crystallization:** When `weak` resolve cycles back to building, guidance is **accumulated** across iterations (not overwritten). Components graded `rejected` within an overall `weak` experiment are registered as dead-ends immediately. The synthesiser can flag provably dead approaches with `[DEAD-APPROACH]` markers, which are also inserted as dead-ends (Tradition 3: chain provenance — insights must survive across iterations).
- **Centralized ANSI output:** All terminal formatting goes through `src/output/format.ts`. Supports `NO_COLOR` env var and TTY detection. `shared/validation.ts` has its own local `NO_COLOR` gate (no cross-package dependency).

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
# 2. Update the npm badge version in README.md (shields.io badge at top of file)
# 3. Commit with message format: "Majlis vX.Y.Z — brief description"
# 4. Tag with: git tag vX.Y.Z
# 5. Push commit and tag: git push && git push --tags
# CI on GitHub handles npm publish from the tag.
```
- All three packages share the same version number.
- `@majlis/shared` is `private: true` — CI skips it during publish.
- Commit message convention: `Majlis vX.Y.Z — feature/fix summary`.
- README badge uses `https://img.shields.io/badge/npm-vX.Y.Z-blue` linked to the npm package page.
