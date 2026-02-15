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

```
┌─────────────────────────────────────────────────────────────┐
│                    LAYER 3: LLM Agents                      │
│  builder(opus) · critic(sonnet) · adversary(sonnet)         │
│  verifier(sonnet) · reframer(opus) · compressor(opus)       │
│  scout(sonnet)                                              │
│                                                             │
│  Creative work. Judgment calls. The scholarship.            │
├─────────────────────────────────────────────────────────────┤
│                    LAYER 2: majlis CLI                       │
│  State machine · Cycle enforcement · Circuit breakers        │
│  Agent spawning · Metric comparison · Regression detection   │
│                                                             │
│  Deterministic. TypeScript. The adab (rules of engagement). │
├─────────────────────────────────────────────────────────────┤
│                    LAYER 1: SQLite + Git                     │
│  Experiment state · Evidence tags · Metrics history          │
│  Dead-end registry · Fragility map · Session log            │
│                                                             │
│  Persistent. Queryable. The institutional memory.           │
└─────────────────────────────────────────────────────────────┘
```

## The Cycle

```
1. CLASSIFY   → Taxonomy before solution (Al-Khwarizmi)
2. REFRAME    → Independent decomposition (Al-Biruni)
3. BUILD      → Write code with tagged decisions (Ijtihad)
4. CHALLENGE  → Construct breaking inputs (Ibn al-Haytham)
5. DOUBT      → Systematic challenge with evidence (Shukuk)
6. SCOUT      → External search for alternatives (Rihla)
7. VERIFY     → Provenance + content checks (Isnad + Matn)
8. RESOLVE    → Route based on grades
9. COMPRESS   → Shorter and denser (Hifz)
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
| **Critic** | Challenges with evidence, produces doubt documents | sonnet |
| **Adversary** | Constructs pathological inputs to break approaches | sonnet |
| **Verifier** | Dual provenance + content checks, grades components | sonnet |
| **Reframer** | Independently decomposes from scratch (never sees builder code) | opus |
| **Compressor** | Compresses, cross-references, maintains dead-end registry | opus |
| **Scout** | Searches externally for alternative approaches | sonnet |

## Commands

| Action | Command |
|--------|---------|
| Initialize | `majlis init` |
| Status | `majlis status` |
| New experiment | `majlis new "hypothesis"` |
| Baseline metrics | `majlis baseline` |
| Next step | `majlis next` |
| Auto cycle | `majlis next --auto` |
| Build | `majlis build [experiment]` |
| Challenge | `majlis challenge [experiment]` |
| Doubt | `majlis doubt [experiment]` |
| Scout | `majlis scout [experiment]` |
| Verify | `majlis verify [experiment]` |
| Resolve | `majlis resolve [experiment]` |
| Compress | `majlis compress` |
| Classify | `majlis classify "domain"` |
| Reframe | `majlis reframe [classification]` |
| Audit | `majlis audit "objective"` |
| Session start | `majlis session start "intent"` |
| Session end | `majlis session end` |
| Decisions | `majlis decisions [--level L]` |
| Dead-ends | `majlis dead-ends [--sub-type S]` |
| Autonomous | `majlis run "goal"` |

## Resolution

- **Sound** → Merge
- **Good** → Merge + add gaps to fragility map
- **Weak** → Cycle back with synthesised guidance
- **Rejected** → Dead-end with structural constraint

**Circuit breaker:** 3+ weak/rejected on same sub-type triggers a Maqasid Check (purpose audit).

## Configuration

`.majlis/config.json`:

```json
{
  "project": {
    "name": "my-project",
    "description": "...",
    "objective": "..."
  },
  "metrics": {
    "command": "python scripts/benchmark.py --json",
    "fixtures": ["fixture1", "fixture2"]
  },
  "cycle": {
    "compression_interval": 5,
    "circuit_breaker_threshold": 3,
    "require_doubt_before_verify": true
  }
}
```

## Claude Code Integration

Majlis integrates with Claude Code through:

- **Agents** (`.claude/agents/`) — Native agent discovery for each role
- **Slash commands** (`.claude/commands/`) — `/classify`, `/doubt`, `/challenge`, `/verify`, `/reframe`, `/compress`, `/scout`, `/audit`
- **Hooks** (`.claude/settings.json`) — Session start status, commit gates, subagent notifications

## Philosophy

Every hard problem is an act of seeking truth in a space no one has mapped. This framework draws from fifteen traditions of Islamic scholarship on how to manage complexity, verify truth, and make decisions under uncertainty. See [FOUNDATIONS.md](FOUNDATIONS.md) for the full intellectual lineage.

## License

MIT
