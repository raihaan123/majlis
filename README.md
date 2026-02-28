# Majlis

Structured multi-agent problem solving through doubt, verification, and compressed knowledge.

## Quick Start

```bash
npx create-majlis my-project && cd my-project
majlis status
```

Or add to an existing project:

```bash
npx create-majlis --init
```

## What This Is

Majlis is a multi-agent workflow framework for [Claude Code](https://docs.anthropic.com/en/docs/claude-code), designed for problems where nobody has found the answer before — algorithm discovery, novel engineering, mathematical research. It gives AI agents distinct roles with enforced boundaries so that what gets built also gets challenged, verified, and compressed into durable knowledge.

**This is not for:** fixing syntax errors, standard API integration, boilerplate generation, or any problem where the answer is already known.

**This is for:** novel algorithm development, mathematical proof exploration, complex system design where failure modes are unknown, and any problem where being confidently wrong is more expensive than being slow.

## Architecture

Three packages in a monorepo:

- `packages/majlis` — The CLI. Deterministic state machine, SQLite persistence, agent spawning.
- `packages/create-majlis` — NPX scaffolder that bootstraps Majlis into a project.
- `packages/shared` — Internal package (`@majlis/shared`). Agent definitions, templates, config defaults, validation. Bundled into both consumer packages via tsup.

```
+---------------------------------------------------------+
|                  LAYER 3: LLM Agents                    |
| builder(opus) . critic(opus) . adversary(opus)          |
| verifier(opus) . reframer(opus) . compressor(opus)      |
| scout(opus) . gatekeeper(sonnet)                        |
|                                                         |
| Creative work. Judgment calls. The scholarship.         |
+---------------------------------------------------------+
|                  LAYER 2: majlis CLI                     |
| State machine . Cycle enforcement . Circuit breakers    |
| Agent spawning . Metric comparison . Regression gates   |
| Experiment dependencies . Scoped context injection      |
|                                                         |
| Deterministic. TypeScript. The adab (rules).            |
+---------------------------------------------------------+
|                  LAYER 1: SQLite + Git                   |
| Experiment state . Evidence tags . Metrics history      |
| Dead-end registry . Fragility map . Session log         |
|                                                         |
| Persistent. Queryable. The institutional memory.        |
+---------------------------------------------------------+
```

## The Cycle

```
 1. CLASSIFY   -> Taxonomy before solution (Al-Khwarizmi)
 2. REFRAME    -> Independent decomposition (Al-Biruni)
 3. GATE       -> Hypothesis quality check
 4. BUILD      -> Write code with tagged decisions (Ijtihad)
 5. CHALLENGE  -> Construct breaking inputs (Ibn al-Haytham)
 6. DOUBT      -> Systematic challenge with evidence (Shukuk)
 7. SCOUT      -> External search for alternatives (Rihla)
 8. VERIFY     -> Provenance + content checks (Isnad + Matn)
 9. RESOLVE    -> Route based on grades
10. COMPRESS   -> Shorter and denser (Hifz)
```

## Evidence Hierarchy

Every decision is tagged with its justification level. Stored as database columns, not prompt suggestions.

| Level | Name | Overturn threshold |
|---|---|---|
| 1 | **Proof** | Error found in proof |
| 2 | **Test** | Test shown insufficient |
| 3a | **Strong Consensus** | New contradicting evidence |
| 3b | **Consensus** | Any independent approach contradicts |
| 4 | **Analogy** | Analogy shown structurally false |
| 5 | **Judgment** | Any stronger source contradicts |

## Roles

| Role | Function | Model |
|---|---|---|
| **Builder** | Writes code, runs experiments, tags every decision | opus |
| **Critic** | Challenges with evidence, produces doubt documents | opus |
| **Adversary** | Constructs pathological inputs to break approaches | opus |
| **Verifier** | Dual provenance + content checks, grades components | opus |
| **Reframer** | Independently decomposes from scratch (never sees builder code) | opus |
| **Compressor** | Compresses, cross-references, maintains dead-end registry | opus |
| **Scout** | Searches externally for alternative approaches | opus |
| **Gatekeeper** | Fast hypothesis quality check before building | sonnet |

## Commands

```
Lifecycle:
  init [--scan]              Initialize Majlis in current project
  scan [--force]             Scan codebase to auto-detect config + write synthesis
  resync [--check] [--force] Update stale synthesis after project evolution
  upgrade                    Sync agents, commands, hooks from CLI version
  status [--json]            Show experiment states, cycle position, readiness

Experiments:
  new "hypothesis"           Create experiment, branch, log, DB entry
    --sub-type TYPE          Classify by problem sub-type
    --depends-on SLUG        Block building until dependency is merged
    --context FILE,FILE      Inject domain-specific docs into agent context
  baseline                   Capture metrics snapshot (before)
  measure                    Capture metrics snapshot (after)
  compare [--json]           Compare before/after, detect regressions
  revert                     Revert experiment, log to dead-end

Cycle:
  next [experiment] [--auto] Determine and execute next cycle step
  build [experiment]         Spawn builder agent
  challenge [experiment]     Spawn adversary agent
  doubt [experiment]         Spawn critic agent
  scout [experiment]         Spawn scout agent
  verify [experiment]        Spawn verifier agent
  gate [experiment]          Spawn gatekeeper agent
  resolve [experiment]       Route based on verification grades
  compress                   Spawn compressor agent

Classification:
  classify "domain"          Classify problem space into sub-types
  reframe [classification]   Independent decomposition

Queries:
  decisions [--level L]      List decisions by evidence level
  dead-ends [--sub-type S]   Dead-ends with structural constraints
  fragility                  Show fragility map
  history [fixture]          Metric history for a fixture
  circuit-breakers           Sub-type failure counts
  check-commit               Exit non-zero if unverified experiments

Audit:
  audit "objective"          Maqasid check -- is the frame right?
  diagnose ["focus area"]    Deep diagnosis -- root causes, patterns, gaps

Sessions:
  session start "intent"     Declare session intent
  session end                Log accomplished/unfinished/fragility

Orchestration:
  run "goal"                 Autonomous orchestration until goal met
  swarm "goal" [--parallel N] Run N experiments in parallel worktrees
```

## Resolution

- **Sound** -> Merge
- **Good** -> Merge + add gaps to fragility map
- **Weak** -> Cycle back with synthesised guidance
- **Rejected** -> Dead-end with structural constraint

**Circuit breaker:** 3+ weak/rejected on same sub-type triggers a Maqasid Check (purpose audit).

**Regression gates:** Fixtures flagged as `gate` block merge on regression regardless of verification grades.

## Configuration

`.majlis/config.json`:

```json
{
  "project": {
    "name": "my-project",
    "description": "...",
    "objective": "What are we actually trying to achieve?"
  },
  "metrics": {
    "command": "python scripts/benchmark.py --json",
    "fixtures": {
      "baseline_test": { "gate": true },
      "target_test": {}
    },
    "tracked": {
      "error_rate": { "direction": "lower_is_better" },
      "accuracy": { "direction": "higher_is_better" },
      "value_delta": { "direction": "closer_to_gt", "target": 0 }
    }
  },
  "build": {
    "pre_measure": "make build",
    "post_measure": null
  },
  "cycle": {
    "compression_interval": 5,
    "circuit_breaker_threshold": 3,
    "require_doubt_before_verify": true,
    "require_challenge_before_verify": false,
    "auto_baseline_on_new_experiment": true
  }
}
```

The metrics command must output JSON: `{ "fixtures": { "name": { "metric": value } } }`.

Run `majlis status` to see which config fields are wired up and what's missing.

## Experiment Features

- **Regression gates:** Gate fixtures block merge on regression regardless of verification grades. One weak link invalidates the chain.
- **Dependencies:** `--depends-on SLUG` blocks building until the prerequisite experiment is merged. Ordered problem decomposition.
- **Scoped context:** `--context file1,file2` injects domain-specific reference material into agent prompts. Agents get the right knowledge for the right experiment.
- **Structured metric comparison:** The verifier receives typed comparison results with regression flags and gate markers, not raw numbers.
- **Project readiness:** `majlis status` runs diagnostic checks and surfaces what's configured, what's missing, and what the consequences are.

## Claude Code Integration

Majlis integrates with Claude Code through:

- **Agents** (`.claude/agents/`) — Native agent discovery for each role
- **Slash commands** (`.claude/commands/`) — `/classify`, `/doubt`, `/challenge`, `/verify`, `/reframe`, `/compress`, `/scout`, `/audit`
- **Hooks** (`.claude/settings.json`) — Session start status, commit gates, subagent notifications

## Philosophy

Every hard problem is an act of seeking truth in a space no one has mapped. This framework draws from fifteen traditions of Islamic scholarship on how to manage complexity, verify truth, and make decisions under uncertainty. See [FOUNDATIONS.md](FOUNDATIONS.md) for the full intellectual lineage.

## License

MIT
