# The Majlis Framework — Intellectual Foundations

An agent workflow for solving hard problems through structured doubt, independent verification, and compressed knowledge — derived from Islamic traditions of scholarship, science, and discourse.

---

## Why These Traditions

These are not metaphors applied to engineering. They are methodologies for managing complexity, verifying truth, and making decisions under uncertainty — applied to their original domain of hard, consequential problems.

Every hard problem is an act of seeking truth in a space no one has mapped. The Islamic scholarly tradition developed rigorous methods for this pursuit over eleven centuries. This framework draws from them directly.

---

## The Fifteen Traditions

### 1. The Hafiz Tradition — Preservation Through Active Re-Encoding with Verification

*Quran memorisation and revision*

A codebase, like a memorised text, degrades without active compression. The hafiz fights this not merely through repetition but through three distinct mechanisms:

**Muraja'ah** (systematic review cycles): The hafiz does not simply re-read. They follow structured review schedules — new material daily, recent material weekly, the entire text monthly. Each review cycle tightens the encoding. The compression cycle in this framework follows the same logic: periodic, structured, progressively denser.

**Tasmi'** (recitation to a peer for validation): A hafiz recites to a qualified listener who catches errors the reciter cannot detect in themselves. This is independent verification of the compressed form — you cannot validate your own memory. The synthesis document is similarly reviewed by the compressor agent, not the builder who generated the knowledge.

**The Mauritanian luh method** (write, memorise, wash, rewrite): In the Mauritanian tradition, students write verses on a wooden board (luh), memorise them, wash the board, and rewrite from memory. The act of rewriting forces deeper processing than mere re-reading. Our compression cycle rewrites the synthesis from scratch each time — shorter and denser — rather than appending. Rewriting is compression. Appending is accumulation.

The goal is not perfect recall but perfect compression: 604 pages that feel like one page. A codebase's entire state that fits in one document.

**What it prevents:** Context loss across sessions.

### 2. The Shukuk Tradition — Systematic Scientific Doubt

*Constructive criticism in the tradition of Ibn al-Haytham*

Ibn al-Haytham established a foundational anti-taqlid principle in his *Doubts Concerning Ptolemy* (al-Shukuk 'ala Batlamyus): "The duty of the man who investigates the writings of scientists, if learning the truth is his goal, is to make himself an enemy of all that he reads, and... attack it from every side." He was explicit that this critical stance applies to all authorities *except* prophets — no scholar, however eminent, is above scrutiny through evidence.

His method followed a three-phase cycle that maps directly to our framework:

1. **Shukuk** (doubt) — Identify contradictions, unstated assumptions, logical gaps in existing work
2. **I'tibar** (experiment) — Construct controlled tests to resolve the doubts
3. **Burhan** (proof) — Establish results through demonstration

This is distinct from Cartesian doubt, which is blanket skepticism as a philosophical starting point. Ibn al-Haytham's doubt is *targeted* and *evidence-based* — you doubt a specific claim because you have specific evidence that something is wrong. "This feels off" is not a doubt in this tradition. "This contradicts the result from experiment 3" is.

We formalise doubt as a distinct phase where prior work is systematically challenged, not to discard it, but to strengthen or correct it. The critic agent practises shukuk; the adversary agent practises i'tibar.

**What it prevents:** Unchecked assumptions hardening into truth.

### 3. The Hadith Sciences — Dual Independent Verification

*Isnad (chain of transmission) and Matn (content) verification*

Every hadith was evaluated on two independent axes: is the chain of transmission sound (isnad), and is the content consistent and plausible (matn)? We evaluate code the same way: where did this approach come from (provenance), and does it actually work as claimed (content)?

The hadith sciences developed remarkably sophisticated evaluation methods:

**Jarh wa ta'dil** (narrator criticism): Each narrator in a chain was independently evaluated for reliability. A single weak link invalidates the entire chain, regardless of the strength of other narrators. Our provenance checking works the same way — a single untraceable decision breaks the chain from requirement to code.

**Mutawatir vs. ahad**: A hadith transmitted through so many independent chains that collaboration is impossible (mutawatir) carries a different epistemic weight than one transmitted through a single chain (ahad). This distinction maps directly to our evidence hierarchy: strong consensus (convergence across independent approaches) vs. consensus (agreement from same-model experiments). The number and independence of chains matters.

**Graduated grading**: Scholars did not simply accept or reject. They developed a graduated scale: sahih (sound), hasan (good), da'if (weak), mawdu' (fabricated). Each level has specific operational criteria and specific implications for how the narration can be used. Our grading system (sound, good, weak, rejected) follows the same principle — nuanced assessment with actionable consequences at each level.

**What it prevents:** Untraced provenance and untested claims.

### 4. Al-Khwarizmi's Method — Classification Before Solution

Al-Khwarizmi did not solve individual equations. He first reduced all possible equations to six canonical forms through two fundamental operations:

**Al-jabr** (completion/restoration): Moving negative terms to the other side of the equation, making all terms positive. In our context: reducing a messy, tangled problem statement to a clean form by eliminating negation and indirection.

**Al-muqabala** (balancing): Cancelling equal terms on both sides, reducing to simplest form. In our context: identifying and removing redundancy between sub-problems to reveal the minimal orthogonal set.

Classification in Al-Khwarizmi's method is not merely labelling — it is *reduction to solvable form*. Once he had the six canonical forms, each had a systematic procedure. The classification *was* the solution strategy. We classify the problem space before writing code, so that effort is systematic rather than reactive. Each sub-type should have a known structure that suggests its own approach.

**What it prevents:** Ad hoc problem-solving.

### 5. Usul al-Fiqh — Source Hierarchy for Decisions

*Source methodology in jurisprudence*

Islamic legal reasoning follows a source hierarchy first formally codified by Imam al-Shafi'i in his *al-Risala* — the earliest systematic work on legal methodology. Al-Shafi'i established that reasoning must follow a principled order: Quran, then Sunnah, then ijma' (scholarly consensus), then qiyas (analogical reasoning). Each source has specific operational criteria for when it applies and how it can be overturned.

We follow a parallel hierarchy for technical decisions:

| Level | Name | Meaning | Overturn threshold |
|---|---|---|---|
| 1 | **Proof** (Burhan) | Mathematically proven | Error found in proof |
| 2 | **Test** (I'tibar) | Passed controlled experiment | Test shown insufficient |
| 3a | **Strong Consensus** (Ijma' Haqiqi) | Convergence across independent approaches | New contradicting evidence |
| 3b | **Consensus** (Ijma' Zahiri) | Agreement across same-model experiments | Any independent approach contradicts |
| 4 | **Analogy** (Qiyas) | Justified by similarity to prior work | Analogy shown structurally false |
| 5 | **Judgment** (Ra'y / Ijtihad) | Independent reasoning without precedent | Any stronger source contradicts |

Two additional principles from usul al-fiqh inform the "Judgment" level specifically:

**Istihsan** (juristic preference): When strict analogical reasoning produces an absurd or harmful result, a jurist may exercise considered preference for a better outcome. This maps to cases where the evidence hierarchy would mechanically produce a bad decision — the judgment level allows human override, but requires explicit declaration.

**Maslaha mursala** (public interest): Reasoning based on general principles of benefit when no specific source applies. This maps to architectural decisions that serve the overall project objective without direct precedent. Such decisions are tagged as judgment and are primary targets for doubt.

The hierarchy prevents two failure modes: overturning a proven result on a whim, and treating a provisional guess as settled truth. Both are common in long-running codebases. The cost of changing a decision is proportional to the strength of its justification.

**What it prevents:** Treating guesses as proven facts.

### 6. Al-Biruni's Tahqiq — Cross-Framework Comparison

*Independent reframing from outside the builder's ontology*

Tahqiq — from the Arabic root h-q-q meaning "truth" — means "verification through rigorous cross-reference," not merely "investigation." Al-Biruni's method was distinctively empirical and comparative. He spent thirteen years in India, *learning Sanskrit to access primary sources directly* rather than relying on translations. His *Kitab al-Hind* approached Indian science and philosophy on its own terms, then compared it structurally with Greek and Islamic traditions — not to prove one superior, but to see each more clearly through the lens of the other.

His fundamental insight was that all intellectual frameworks are human constructions, and therefore all contain both illumination and blind spots. The differences between frameworks reveal structural truths invisible from within any single tradition.

The reframer role in our framework embodies this: it receives *only* the problem statement and classification, never the builder's code or reasoning. It independently decomposes the problem and compares its decomposition with the existing one. The scout role extends this further by seeking perspectives from entirely different fields.

When two intelligent agents independently carve the same problem differently, the difference itself is information about the problem's true structure. The reframer should present its findings on their own terms — without judging which decomposition is "better" — because the comparison itself is the valuable output.

**What it prevents:** Being locked into a wrong ontology.

### 7. Ibn al-Haytham's Experimental Falsification — Active Construction of Failure

*Systematically varying conditions to find where theories break*

Ibn al-Haytham did not merely observe — he systematically varied conditions to test whether his hypotheses held. In his optical experiments, he changed aperture size, shape, focal length, and light source intensity to find where theories broke down. His method was not passive observation but *active construction* of conditions designed to produce failure.

The distinction from shukuk (Tradition 2) is important: shukuk is *analytical* doubt — finding contradictions in existing texts, logic, and results. I'tibar (experimental falsification) is *constructive* doubt — building new tests designed to break the approach. Both are in our framework: the critic practises shukuk, the adversary practises i'tibar.

The adversary role does not review code for bugs. It reasons about problem structure to actively construct inputs, edge cases, and conditions designed to break the approach. For novel algorithm discovery, the hardest failures aren't visible to careful review; they require creative construction of pathological cases.

**What it prevents:** Reactive-only criticism.

### 8. 'Ilm al-'Ilal — Cataloguing Failure Structurally

*The Science of Hidden Defects in hadith criticism*

Among the most sophisticated of the hadith sciences was 'ilm al-'ilal — the study of hidden defects in seemingly sound narrations. A hadith could appear perfectly authenticated yet contain a subtle flaw detectable only by a master who had memorised thousands of narrations.

The tradition developed a detailed defect taxonomy:

- **Mudtarib**: Narrations where multiple conflicting versions exist with no clear winner — analogous to approaches where multiple valid implementations conflict and no evidence distinguishes them.
- **Maqlub**: The right content attributed to the wrong source, or the right approach applied to the wrong problem — analogous to using a correct algorithm on a problem it doesn't structurally fit.
- **Ma'lul**: Looks correct on the surface but contains a hidden flaw — analogous to code that passes all visible tests but fails on unconstructed edge cases.

Crucially, scholars didn't just reject flawed narrations — they catalogued them with detailed explanations of the specific defect. Works like Ibn Abi Hatim's *Kitab al-'Ilal* catalogued 2,840 examples. Al-Daraqutni's *al-'Ilal al-Waridah* was similarly comprehensive and indexed for lookup. The defect catalogue was itself a knowledge base — it taught future scholars what patterns of error to watch for.

Dead ends are information. Three failed approaches to a sub-problem, failing for related reasons, reveal structure about the problem that no successful approach contains. Each failure is compressed into a structural constraint that guides future building. Our dead-end registry should be similarly comprehensive and indexed — searchable by sub-type, failure pattern, and structural constraint.

**What it prevents:** Survivorship bias.

### 9. 'Ilm al-Ikhtilaf — Legitimate Disagreement as Information

*The Science of Scholarly Disagreement*

Islamic jurisprudence didn't just tolerate disagreement — it formalised it as a science with a critical distinction between three categories:

1. **Core axioms** (qat'iyyat): Settled matters not open to reinterpretation. In our framework: proven results, passing tests.
2. **Debatable principles** (zanniyyat): Matters where genuine uncertainty merits diverse approaches. In our framework: judgment-level decisions, architectural choices.
3. **Implementation details** (furu'): Where diversity is not just acceptable but beneficial. In our framework: coding style, specific algorithms for well-understood sub-problems.

The key insight is that *only genuine uncertainty merits diversity*. Disagreement about settled facts is error, not ikhtilaf. The four madhabs (Hanafi, Maliki, Shafi'i, Hanbali) represent an *architecture of pluralism* — they disagree on methodology and application while sharing axioms. This is not a failure to reach consensus but a recognition that methodological diversity strengthened the law's ability to handle complexity.

Imam Malik notably refused when the Caliph proposed to impose his compilation as the law of the entire caliphate — he understood that the diversity of approaches among the Companions who had dispersed to different regions was itself valuable.

When parallel approaches converge, that's genuine consensus — earned, not assumed. When they diverge, the divergence is fed to the reframer for structural analysis. Consensus from experiments all run by the same model may reflect shared blind spots rather than genuine convergence.

**What it prevents:** False consensus from same-model experiments.

### 10. Maqasid al-Shariah — Purpose Over Procedure

*Higher Objectives of the Law*

The theory of maqasid has a longer history than al-Shatibi's famous formulation. Al-Ghazali (d. 1111) first articulated the five essential objectives (daruriyyat): preservation of religion, life, intellect, lineage, and property. Al-Shatibi (d. 1388) later developed this into a comprehensive three-tier hierarchy:

1. **Daruriyyat** (necessities): Without these, the system collapses. In our framework: core invariants, data integrity, the hypothesis itself.
2. **Hajiyyat** (needs): Without these, the system works but with significant difficulty. In our framework: performance targets, ergonomic requirements, maintainability.
3. **Tahsiniyyat** (refinements): Enhancements that improve but aren't essential. In our framework: optimisations, code cleanliness, documentation completeness.

Al-Shatibi argued that understanding these higher objectives was a prerequisite for sound legal reasoning — a jurist who knew only the rules without understanding their purposes would produce technically correct but substantively wrong outcomes.

The method for deriving maqasid is **istiqra'** (induction): examining the full corpus of specific rulings to identify the patterns and purposes they collectively serve. You don't declare the purpose top-down; you derive it from the pattern of actual decisions. Our Maqasid Check similarly examines the full history — experiments, failures, dead-ends — to ask whether the current classification still serves the original objective.

This is exactly the failure mode in algorithm discovery: technically correct optimisation of the wrong objective. The code passes all tests, the provenance is clean, the evidence level is strong — but the approach doesn't serve the actual goal because the classification carved the problem wrong.

The Maqasid Check is a circuit breaker: 3+ consecutive failures on the same sub-type triggers a purpose audit. Is the classification serving the objective? Would we decompose differently with what we now know?

**What it prevents:** Optimising the wrong objective.

### 11. Rihla fi Talab al-'Ilm — Travel in Search of Knowledge

*External perspective-seeking*

The rihla tradition was fundamentally *verificationist* in character. Scholars did not travel merely to accumulate more knowledge — they travelled to independently verify what they already had. The most famous example: Jabir ibn Abdullah reportedly travelled for an entire month to Damascus to verify a single hadith from 'Abdullah ibn Unays. Quality over quantity. Independent confirmation over accumulation.

This verificationist impulse distinguishes rihla from mere curiosity. The scholar already has a hypothesis (the hadith they've heard); they travel to find an independent source that confirms or contradicts it. Our scout role follows the same logic: it searches externally not to find "more stuff" but to find perspectives that specifically confirm or contradict the current approach.

Al-Biruni exemplified this most radically: he learned Sanskrit, studied Hindu texts in their original language, and presented Indian knowledge through systematic cross-cultural comparison. He understood that genuinely foreign frameworks don't just add information — they reveal the hidden structure of your own assumptions.

For the hardest problems, the critical bias might be one the entire system shares. External scouting seeks contradictory approaches, alternative formulations from other fields, and known limitations of the current approach.

**What it prevents:** Closed-system blind spots.

### 12. Adab al-Bahth wa al-Munazara — The Art of Disputation

*Formal protocol for structured debate*

Systematised by scholars including al-Samarqandi (d. 1303) and others in the Islamic rhetorical tradition, adab al-bahth wa al-munazara established formal rules for scholarly debate that went far beyond mere argumentation. The framework defined:

**Formal roles**: The *mustawrid* (claimant) who advances a thesis, and the *sa'il* (questioner/respondent) who challenges it. Each role has specific rights and obligations. The claimant must respond to every legitimate challenge. The questioner may only challenge premises that are not self-evident and not already conceded.

**Ethical norms for arguers**: The goal of debate is *izhar al-haqq* (manifestation of truth), not victory. A disputant who argues to win rather than to find truth has violated the adab of the practice. Ad hominem attacks, misrepresentation, and evasion are formal violations.

**Structured exchange**: Each round has a defined structure — claim, challenge, response, counter-response — with rules about what kinds of moves are legitimate at each stage.

This is essentially the formal protocol for how our agents interact. The builder advances claims (experiments, decisions). The critic challenges with evidence. The builder must respond to confirmed doubts on the next cycle, not dismiss them. The verifier judges without taking sides. The entire exchange is governed by shared norms (the evidence hierarchy, the state machine) that prevent any single agent from dominating through rhetorical force rather than evidence.

**What it prevents:** Unstructured or adversarial agent interaction.

### 13. Ijtihad — Independent Legal Reasoning

*Qualified independent reasoning*

Ijtihad — from the same root as jihad, meaning "maximum effort" — is the practice of independent reasoning to derive new rulings from established sources. But not just anyone may practise ijtihad. The mujtahid (qualified practitioner) has prerequisites:

- Mastery of the source texts (Quran, hadith)
- Understanding of the methodological principles (usul al-fiqh)
- Knowledge of prior scholarly consensus and disagreement
- Ability to reason by analogy (qiyas) correctly
- Understanding of the higher objectives (maqasid)

This maps to "agent qualification" — what must an agent demonstrate before being trusted with judgment-level decisions? The builder agent is given the full context (synthesis, dead-ends, classification, prior experiments) precisely so it can exercise qualified judgment. A builder without this context is practising ijtihad without mastery of sources — its "reasoning without precedent" is actually "reasoning without awareness of relevant precedent," which is a different and more dangerous thing.

The closing of the "gate of ijtihad" — the medieval view that independent reasoning was no longer needed because earlier scholars had covered everything — is the failure mode of over-reliance on precedent. Our framework keeps the gate open: judgment-level decisions are always legitimate, but they are also always the primary targets for doubt.

**What it prevents:** Unqualified judgment and over-reliance on precedent.

### 14. Shura — Consultation

*Collective decision-making*

Shura (consultation) is a Quranic principle — "and whose affair is consultation among themselves" (42:38). The early Caliphs used shura for achieving consensus on matters that affected the community. Abu Bakr and 'Umar consulted the Companions before major decisions; the process was not merely advisory but constitutive — a decision made without proper consultation lacked legitimacy.

This maps to how agents consult shared project state before acting. No agent operates in isolation from the collective knowledge. The builder reads the synthesis before building. The critic reads prior experiments before doubting. The verifier reads both doubts and challenges before verifying. The shared project state (SQLite database, docs/ tree, synthesis) is the common council that every agent consults.

The key insight from shura is that consultation must be *genuine* — not a formality. The synthesis must be read, not merely available. The dead-ends must inform the approach, not merely exist in a database. The framework enforces this by injecting relevant context into each agent's invocation.

**What it prevents:** Isolated decision-making without collective knowledge.

### 15. Tajwid — Precision in Transmission

*Error-correction rules for Quran recitation*

Where hifz (Tradition 1) preserves the *content* of the text, tajwid preserves its *fidelity* — the exact pronunciation of every phoneme, the precise duration of every elongation, the correct point of articulation for every letter. Tajwid rules exist because subtle distortions in recitation compound over generations: a slight mispronunciation today becomes an unrecognisable sound in a century.

This maps to precision in inter-agent communication. When the builder's output is passed to the critic, when the verifier's grades determine the resolution, when the synthesiser's guidance is injected into the next build cycle — each handoff is a point where subtle distortions can enter. A grade of "good" that the verifier intended as "barely acceptable" might be interpreted by the resolution logic as "comfortably adequate." A doubt that the critic intended as critical might be compressed into a minor concern.

Our framework addresses this through structured data formats (the `<!-- majlis-json -->` blocks), typed database columns (evidence levels are enums, not free text), and the three-tier parsing strategy that ensures structured intent survives even when formatting is imperfect. The state machine operates on precise, typed values — not on natural language summaries that could drift.

**What it prevents:** Subtle distortions in inter-agent handoffs.

---

## The Majlis — A Gathering for Discourse

A majlis is a gathering for discourse. In the Islamic scholarly tradition, productive discourse required distinct roles with clear boundaries and etiquette (adab). The munazara (structured debate) had formal rules about who could challenge what, when, and how the claimant must respond. Truth emerged not from a single brilliant mind but from the interaction of specialised roles operating under shared principles.

### The Roles

| Role | Arabic Origin | Function | Authority |
|---|---|---|---|
| **Builder** | Mujtahid — independent reasoner | Writes code, runs experiments, makes tagged decisions | Write code + experiments |
| **Critic** | Shakk — constructive doubt | Challenges with evidence, produces doubt documents | Read-only, write doubts |
| **Adversary** | Mu'arid — active opposition | Constructs pathological inputs to break approaches | Read-only, write challenges |
| **Verifier** | Muhtasib — quality inspector | Dual provenance + content checks, grades components | Read + run tests, write reports |
| **Reframer** | Muhaqiq — independent investigator | Independently decomposes from scratch, never sees builder code | Read problem + classification only |
| **Compressor** | Hafiz — memoriser/preserver | Compresses, cross-references, maintains dead-end registry | Read all, write synthesis |
| **Scout** | Rahhal — knowledge traveller | Searches externally for alternative approaches and contradictory evidence | Read all, web search, write rihla reports |

### The Adab of Agents

In the munazara tradition, productive discourse required adab — etiquette:

- The doubter may only challenge premises that are not self-evident and not already conceded
- The claimant must respond to every legitimate challenge
- The moderator must not take sides

For agents:
- The Critic may not raise doubts without evidence
- The Builder must respond to every confirmed doubt, not dismiss them
- The Verifier must grade honestly — if a component is weak, it is weak regardless of how much effort went into it
- The state machine must not favour one agent's output over another except through the source hierarchy

### The Isolation Principle

Each agent operates in its own context window with only the project files as shared ground truth. No agent inherits another agent's reasoning chain.

In hadith science, each narrator in the chain is evaluated independently. A single weak narrator invalidates the chain even if every other narrator is strong. If the doubter inherits the builder's chain of thought, its doubt is compromised. If the verifier inherits the doubter's suspicions, its verification is biased.

---

## The Cycle

```
1. CLASSIFY        — Al-Khwarizmi: taxonomy before solution
2. REFRAME         — Al-Biruni: independent decomposition
   → Compare. If divergent, resolve before building.
3. BUILD           — Ijtihad: independent reasoning with tagged decisions
4. CHALLENGE       — Ibn al-Haytham: construct breaking inputs
5. DOUBT           — Shukuk: systematic challenge with evidence
6. SCOUT           — Rihla: external search for alternatives
7. VERIFY          — Isnad + Matn: provenance and content checks
8. RESOLVE         — Route based on grades
   → 3+ failures on same sub-type: Maqasid Check (circuit breaker)
9. COMPRESS        — Hifz: shorter and denser, including dead-end registry
```

### Resolution

- **Sound** — all components proven. Safe to merge.
- **Good** — works but has gaps. Merge and record gaps in fragility map.
- **Weak** — needs another build cycle. Synthesise guidance for the builder.
- **Rejected** — demonstrably broken. Dead-end it. Record structural constraint.

---

## The Philosophy in One Paragraph

Every hard problem is an act of seeking truth in a space no one has mapped. Classify before you solve. Decompose independently. Build with tagged justification. Challenge with constructed counterexamples. Doubt systematically with evidence. Scout externally for perspectives you couldn't generate. Verify independently on both provenance and content. Learn structurally from failure. Seek real consensus from diverse approaches, not apparent consensus from repeated blind spots. Check that the frame itself is right. Compress relentlessly so the whole project fits on one page. And when the frame itself is wrong, have the courage to start over with everything you've learned.

The state machine holds the rules. The agents do the scholarship. The database remembers everything. Git branches contain the risk.

Every decision traceable. Every doubt addressed. Every failure catalogued. Every assumption that can be broken, broken before it matters.

**The majlis is in session.**
