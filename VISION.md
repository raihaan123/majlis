# Majlis — Vision: From CLI to Research Methodology

## The Observation

Majlis was built to solve a specific problem: AI coding agents are confidently wrong on hard problems. The solution — a deterministic state machine enforcing structured doubt, independent verification, and compressed knowledge — works. In practice, dead-ended experiments produce genuine structural constraints that accumulate into a clear picture of the problem space. The methodology forces rigour that unstructured agent workflows don't.

But the methodology that makes this work has nothing to do with code.

The 15 traditions that Majlis draws from (see [FOUNDATIONS.md](FOUNDATIONS.md)) were developed across eleven centuries for problems far harder than software: establishing the authenticity of prophetic sayings across centuries of transmission, resolving legal questions with civilizational consequences, reconciling contradictory scientific frameworks across cultures. The scholars who built these methods didn't have test suites. They had *structured evaluation under genuine uncertainty* — and they were methodologically rigorous about it in ways modern research often isn't.

The current CLI conflates two things: a domain-agnostic **methodology engine** (the state machine, evidence hierarchy, doubt cycle, dead-end registry, compression) and a domain-specific **coding integration** (git branches, metrics commands, build systems). These need to separate.

## What's Domain-Agnostic

The entire intellectual framework survives generalization unchanged:

**The state machine.** `CLASSIFY → GATE → BUILD → DOUBT → CHALLENGE → VERIFY → RESOLVE → COMPRESS` describes any rigorous research cycle. You classify the problem before proposing a solution. You gate the hypothesis before investing effort. You build an artifact. You doubt it with evidence. You challenge it with adversarial construction. You verify independently. You resolve based on grades. You compress what you learned. This is the scientific method with teeth.

**The evidence hierarchy.** Proof > Test > Strong Consensus > Consensus > Analogy > Judgment. This is Usul al-Fiqh (Tradition 5) — every decision tagged with its justification level, every level with a specific overturn threshold. A proven mathematical result can only be overturned by finding an error in the proof. A judgment call can be overturned by any stronger evidence. This hierarchy is more rigorous than how most research actually tracks its own confidence levels.

**Dead-ends as structural knowledge.** 'Ilm al-'Ilal (Tradition 8) — failure catalogues are knowledge. Three failed proof strategies for the same lemma, failing for related reasons, reveal structure about the lemma that no successful proof contains. The dead-end registry with structural constraints is domain-agnostic.

**The circuit breaker and maqasid audit.** Three consecutive failures on the same sub-problem triggers a purpose audit (Tradition 10). Are we even asking the right question? This is the most important safeguard against the most common research failure mode: technically rigorous work on the wrong problem.

**Compression.** The Hafiz tradition (Tradition 1) — periodic rewriting of institutional memory, shorter and denser. This prevents context loss whether the context is a codebase, a proof development, a literature review, or a multi-year experimental program. The Mauritanian *luh* method: write, memorize, wash, rewrite. Rewriting is compression. Appending is accumulation.

**Isolation.** Each agent operates independently. The critic doesn't inherit the builder's reasoning chain. The verifier doesn't inherit the critic's suspicions. In hadith science (Tradition 3), each narrator in the chain is evaluated independently. A single weak link invalidates the chain even if every other narrator is strong. Independence is not a luxury — it's a structural requirement for trustworthy verification.

## What Changes: Domain Adapters

A domain adapter defines five things:

### 1. Artifact Type

What the builder produces. Currently: source files. But an artifact could be:
- A formal proof (Lean4, Coq, Agda, or informal LaTeX)
- A manuscript section (paper, thesis chapter, grant proposal)
- An experimental protocol (materials, procedures, analysis plan)
- A mathematical construction (definitions, lemmas, theorems)
- A system design (architecture documents, specifications)
- A policy analysis (argument, evidence, recommendations)

The state machine doesn't care what the artifact is. It cares that the artifact exists, can be doubted, can be challenged, can be verified, and can be graded.

### 2. Versioning

How artifacts are tracked across experiments. Currently: git branches. But versioning could be:
- Git (code, Lean4 files, LaTeX)
- Document snapshots in SQLite (lightweight, no external dependencies)
- No versioning (each experiment is self-contained)

Git is an optimization for code, not a requirement for the methodology. A proof development might use git. A one-off experimental design might not. The dead-end record in SQLite is the permanent knowledge store regardless.

### 3. Verification Method

How grades are produced. This is the critical generalization. Currently: `metrics.command` runs a test suite, produces numbers, the verifier grades against regression. But verification in the hadith tradition (Tradition 3) was never automated — it was *structured expert evaluation* against defined criteria:

**Oracle verification** (current) — A deterministic command produces measurable results. The verifier checks for regression against baseline. This is *isnad* verification: the chain is mechanically checkable. Works for: code with tests, formal proofs with proof checkers, any domain with a deterministic oracle.

**Rubric verification** — The verifier evaluates the artifact against defined criteria. "Does the proof handle the edge case raised in Doubt #2?" "Is the experimental design powered to detect the expected effect size?" "Does the argument address the counterexample from Challenge #1?" This is *matn* verification: content evaluation by a qualified evaluator. Works for: papers, informal proofs, experimental designs, policy analysis.

**Human verification** — The AI verifier proposes a grade with justification. The experiment pauses at `verified` for human confirmation. The human accepts, overrides, or sends back for more work. This is *tasmi'* (Tradition 1): recitation to a qualified listener. Works for: any domain where the human expert is the ultimate arbiter.

**Consensus verification** — Multiple independent verifier runs. If they agree, that's *ijma' haqiqi* (strong consensus, Tradition 9). If they disagree, the disagreement is itself information. Grade is derived from the distribution of independent assessments. Works for: high-stakes decisions where a single evaluation is insufficient.

These modes are not mutually exclusive. A formal proof might use oracle verification (proof checker) AND rubric verification (does the proof actually prove what was claimed, not just type-check?). A paper might use rubric verification by AI AND human verification by the advisor.

### 4. Agent Capabilities

What tools each agent has access to. Currently: all agents get file system access (Read, Write, Edit, Glob, Grep, Bash). But:
- A proof builder needs a proof assistant (Lean4 REPL, Coq)
- A paper builder needs citation databases and web search
- An experimental design builder needs statistical power calculators
- A scout in any domain needs domain-specific search (arXiv, PubMed, Google Scholar)

Agent capabilities become adapter-defined rather than hardcoded.

### 5. Resolution Criteria

What constitutes sound/good/weak/rejected in this domain. The graduated grading from hadith science (Tradition 3) applies everywhere, but the specific criteria are domain-dependent:

| Grade | Code | Proof | Paper | Experiment |
|-------|------|-------|-------|------------|
| **Sound** | All tests pass, no regressions, provenance clean | Proof checks, all edge cases handled, no gaps | Claims supported, methodology sound, novel contribution clear | Design valid, powered, confounds addressed |
| **Good** | Works but has gaps in coverage | Proof checks but some cases hand-waved | Argument holds but needs stronger evidence in places | Design valid but borderline power |
| **Weak** | Partial, needs another iteration | Key lemma unproven or gap identified | Major claim unsupported or methodology flaw | Design has confound or insufficient power |
| **Rejected** | Fundamentally broken | Proof strategy fails structurally | Core argument invalid | Design cannot answer the research question |

## The Collaborative Dimension

The current CLI is single-user: one researcher, one Claude, one terminal. But the traditions point toward something richer.

Shura (Tradition 14) — consultation must be genuine, not a formality. In the current system, "consultation" means agents reading shared SQLite state. But real shura involves *multiple qualified participants* with different expertise and perspectives.

'Ilm al-Ikhtilaf (Tradition 9) — legitimate disagreement between qualified scholars is information, not failure. The four madhabs disagree on methodology while sharing axioms. In a research group, different researchers might decompose the same problem differently (reframing), or challenge each other's approaches (doubt/adversary), or verify each other's work (verification). The disagreement pattern reveals the problem's true structure.

What this looks like in practice:

**A PhD advisor-student workflow.** The student runs experiments (builder). The advisor reviews periodically (human verification). The dead-end registry and synthesis persist across the student's entire program. When the student graduates, the next student inherits not just the code but the structural constraints, the failed approaches, the compressed state of the research. The institutional memory survives the individual.

**A research group workflow.** Multiple researchers work on related sub-problems (experiment dependencies, parallel swarm-like exploration). Each researcher's dead-ends inform the others. The synthesis compresses across all participants. The maqasid audit asks whether the group's collective direction still serves the original research question.

**A paper writing workflow.** One researcher builds sections. Another doubts claims against the literature. A third constructs adversarial counterarguments. The verification is rubric-based against the target venue's criteria. The compression cycle produces progressively tighter drafts.

This doesn't require a platform rewrite. It requires the persistence layer (SQLite + artifact store) to be shared, and the agent spawning to support multiple human participants alongside AI agents. The methodology engine is already designed for multiple participants — the munazara (Tradition 12) defines formal roles for claimant, questioner, and moderator.

## What Doesn't Change

The invariants that hold across every domain:

1. **The state machine is deterministic.** No LLM decides routing. Grades and transitions are mechanical.
2. **Every decision is tagged with evidence level.** The cost of overturning a decision is proportional to the strength of its justification.
3. **Dead-ends are structural knowledge.** Failure is catalogued, indexed, and injected into future work.
4. **Compression is rewriting, not appending.** The synthesis gets shorter and denser, not longer.
5. **Independence is structural.** The verifier never inherits the builder's reasoning chain.
6. **The maqasid audit is always available.** Three consecutive failures trigger a purpose check.
7. **The evidence hierarchy is universal.** Proof > Test > Strong Consensus > Consensus > Analogy > Judgment.

## Practical Trajectory

The path from current CLI to research methodology framework:

**Phase 1 — Decouple.** Extract the methodology engine from the coding integration. Define the adapter interface. Make the current coding behavior a `coding` adapter. This is a refactor, not a feature addition. The CLI works exactly the same; the internals are cleaner.

**Phase 2 — Verification modes.** Add `rubric` and `human` verification alongside `metrics`. This is the minimum viable generalization — it makes Majlis usable for problems without a deterministic oracle. A researcher working on an informal proof can use Majlis with rubric verification immediately.

**Phase 3 — Domain adapters.** Build a `proof` adapter (Lean4/Coq integration) and a `paper` adapter (citation tools, rubric-based verification, manuscript artifact handling). These are proof-of-concept adapters that validate the adapter interface and demonstrate the generalization.

**Phase 4 — Collaborative persistence.** Make the SQLite + artifact store shareable across participants. Support multiple humans alongside AI agents in the same Majlis session. This is where the full vision of shura and ikhtilaf comes alive.

Each phase is independently useful. Phase 1 is pure refactoring. Phase 2 unlocks new use cases immediately. Phase 3 validates the architecture. Phase 4 is the long game.

## The Name

*Majlis* — a gathering for discourse. Not a gathering for coding. The name was always bigger than the implementation.
