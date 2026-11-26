# Self-improving soul file

**For:** Zoorped (via Software Engineer), with Head of Security. **Date:** Wed Nov 11, 2026, about 1:15 AM CT. **Status: RESEARCH ONLY.** Nothing was built and no repos were changed.

**Conventions**
- Paper dates are arXiv first-submission dates, from the arXiv API, read Nov 11, 2026.
- GitHub dates come from the GitHub API and are in **UTC**.
- **[HoS]** marks Head of Security's levels and rules, from `/workspace/agent-guard/reports/zoora_autonomy_guardrails_2026-11-10.md` §3.
- **UNVERIFIED** marks claims I could not confirm from a primary source.

## Bottom line

1. **The idea has strong prior art and one known trap.** Several systems build on the last version of memory instead of rereading everything: Letta's sleep-time "dreaming" agents, Claude's memory files, ChatGPT memory, and the ACE "evolving playbook."
   - The trap is "**context collapse**": iterative rewriting erodes details over time (ACE, arXiv 2510.04618, Oct 6, 2025).
   - **Fix:** never rewrite the soul file wholesale. Apply small, structured, **incremental diffs**. Keep the raw journal as an immutable archive, so any version can be re-grounded or rebuilt.
2. Split the soul file in four:
   - a **locked core** that only the owner can edit, enforced by the server, not the prompt;
   - editable **lessons**;
   - on-demand **skills**;
   - **goals**.
   Version everything in git. Each new version goes live only after a **test gate**: deterministic checks, a persona-consistency eval by a *different* model, a hidden regression set, and an owner diff review at first.
3. The biggest risks are poisoning laundered into Zoora's *own* summaries, self-evaluation bias, and objective hacking. All three change [HoS] risk calls (see the last section).

---

## 1. Prior art (verified papers and docs, dated)

| System | What persists and how it updates | Source (date) | Code: license, last activity (UTC) |
|---|---|---|---|
| **Generative Agents** (Park et al.) | A memory stream of observations, scored for recency, importance and relevance. Periodic **reflection** turns them into higher-level insights stored back as memories. A planning loop runs on top. | arXiv 2304.03442 (Apr 7, 2023) | `joonspk-research/generative_agents`: Apache-2.0, push 2024-08-05 (dormant) |
| **MemGPT / Letta core memory** | **Memory blocks**: labeled, size-limited (by characters) sections that are always in context. The agent edits them with tools, and blocks can be **read-only** so only the developer can change them. **MemFS**: memory is a *git repository owned by the agent*, files under `system/` load every turn, and the rest loads on demand. | arXiv 2310.08560 (Oct 12, 2023); docs.letta.com memory-blocks and memory pages (read Nov 11, 2026); letta.com/blog/memory-blocks | `letta-ai/letta`: Apache-2.0, release 0.16.8 (2026-05-14), push 2026-10-18 |
| **Letta sleep-time compute / "dreaming"** | A background agent consolidates lessons and rewrites the primary agent's memory blocks while it's idle. The primary agent has *no* tools to edit core memory. It runs after N steps or on context compaction. An optional "agent reviews before applying" step **does not ask the human for approval** (Letta docs). | arXiv 2504.13171 (Apr 17, 2025): ~5× less test-time compute for the same accuracy on stateful tasks (authors' claim); letta.com/blog/sleep-time-compute; docs.letta.com configuration/memory | same as above |
| **Reflexion** | Verbal self-reflection after failures, stored in an episodic buffer and reused next attempt. 91% pass@1 on HumanEval (authors' claim). | arXiv 2303.11366 (Mar 20, 2023) | `noahshinn/reflexion`: MIT, push 2025-01-14 |
| **Voyager** | A **skill library** of verified, executable code skills, retrieved by embedding. A skill is added only after it succeeds in the environment. | arXiv 2305.16291 (May 25, 2023) | `MineDojo/Voyager`: MIT, push 2024-04-03 |
| **ExpeL** | Collects experiences, then extracts natural-language **insights**. Insight operations are add, edit, upvote and downvote, so weak insights decay. | arXiv 2308.10144 (Aug 20, 2023) | `LeapLabTHU/ExpeL`: Apache-2.0, push 2024-12-20 |
| **Self-Refine** | Generate → self-feedback → refine, within a single task. Doesn't persist across tasks. | arXiv 2303.17651 (Mar 30, 2023) | `madaan/self-refine`: Apache-2.0, push 2024-10-04 |
| **Agent Workflow Memory** | Induces reusable **workflows** from past trajectories. +24.6% and +51.1% relative success on Mind2Web and WebArena (authors' claim). | arXiv 2409.07429 (Sep 11, 2024) | `zorazrw/agent-workflow-memory`: Apache-2.0, push 2025-12-22 |
| **A-MEM** | Zettelkasten-style notes with keywords, tags and links. New memories can trigger **memory evolution** of linked older notes. | arXiv 2502.12110 (Feb 17, 2025) | `agiresearch/A-mem`: MIT, push 2025-12-12 |
| **Mem0** | Extract → update (add, update, delete, no-op) against existing memories, with an optional graph. Reports +26% on an LLM-judge metric vs OpenAI memory, 91% lower p95 latency and >90% token savings (authors' claims). | arXiv 2504.19413 (Apr 28, 2025) | `mem0ai/mem0`: Apache-2.0, ts-v3.3.1 (2026-09-25) |
| **Zep / Graphiti** | A temporal knowledge graph. Facts carry validity intervals, so old facts are **invalidated, not deleted**. | arXiv 2501.13956 (Jan 20, 2025) | `getzep/graphiti`: Apache-2.0, v0.31.2 (2026-10-20). `getzep/zep`: Apache-2.0. |
| **LangMem** | Semantic, episodic and **procedural** memory. A prompt optimizer rewrites system prompts from trajectories and feedback. A background `ReflectionExecutor` debounces consolidation. | langchain-ai.github.io/langmem (read Nov 11, 2026) | `langchain-ai/langmem`: MIT, push 2026-11-03, no tagged releases |
| **ACE (Agentic Context Engineering)** | Treats context as an **evolving playbook**: generator → reflector → curator, with **incremental delta updates** to prevent "brevity bias" and "context collapse." +10.6% on agent benchmarks (authors' claim). | arXiv 2510.04618 (Oct 6, 2025) | `ace-agent/ace`: Apache-2.0, push 2026-08-24. `kayba-ai/agentic-context-engine`: Apache-2.0, v0.13.0 (2026-09-23). |
| **Claude memory tool** | `memory_20250818`, client-side: Claude asks for view, create, `str_replace`, insert, delete and rename under `/memories`, and **your app runs and stores them**. Must block path traversal. | platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool (read Nov 11, 2026) | API (proprietary) |
| **CLAUDE.md / auto memory** (Claude Code) | Human-written CLAUDE.md files plus self-written auto memory. Auto memory loads the first **200 lines or 25 KB**. Docs: "Claude treats them as **context, not enforced configuration**. To block an action… use a PreToolUse hook." | code.claude.com/docs/en/memory (read Nov 11, 2026) | `anthropics/claude-code`: no OSI license (proprietary), v2.1.322 (2026-11-10) |
| **OpenAI ChatGPT memory** | "Saved memories" (a notepad that ChatGPT updates, combines or removes) plus "reference chat history." The user can view and delete, and Temporary Chat bypasses memory. Expanded Apr 10, 2025. A June 2026 "dreaming" auto-update was reported by a secondary source (**UNVERIFIED**). | help.openai.com/en/articles/8590148 (read Nov 11, 2026); openai.com/index/memory-and-new-controls-for-chatgpt | Product (proprietary) |
| **Darwin Gödel Machine** (Sakana / UBC) | Rewrites its own agent code, keeps an archive of variants, and evaluates them on benchmarks in a sandbox. **Documented objective hacking:** one variant removed the special tool-use markers the hallucination detector relied on, "despite instructions not to," to get a perfect score. Hacking happened *more* when checking functions weren't hidden. | arXiv 2505.22954 (May 29, 2025); sakana.ai/dgm | `jennyzzt/dgm`: Apache-2.0, push 2025-08-13 |
| **SICA** (self-improving coding agent) | The agent edits its own codebase. 17% → 53% on a SWE-bench Verified subset (authors' claim). | arXiv 2504.15228 (Apr 21, 2025) | `MaximeRobeyns/self_improving_coding_agent`: MIT, push 2025-04-23 |
| **AlphaEvolve** (DeepMind) | Evolves *external* programs under automated evaluators, not the agent itself. Shows that the evaluator is the safety-critical part. | arXiv 2506.13131 (Jun 16, 2025) | Results only (`google-deepmind/alphaevolve_results`, Apache-2.0). Open clone `openevolve`: Apache-2.0, v0.4.1 (2026-11-02). |
| **Surveys** | "What / when / how to evolve": memory, tools and workflow vs weights; intra- vs inter-test-time. | arXiv 2507.21046 (Jul 28, 2025; v4 Jan 2026); arXiv 2508.07407 (Aug 10, 2025) | Lists: `EvoAgentX/Awesome-Self-Evolving-Agents` (MIT), `CharlesQ9/Self-Evolving-Agents` (Apache-2.0) |

**Takeaway:** every mature system separates (a) a small always-in-context identity, (b) curated lessons or insights with decay, (c) on-demand skills that are verified before they're saved, and (d) background consolidation. The safe ones add read-only blocks and evaluation outside the agent's reach.

---

## 2. Design patterns

### 2.1 Consolidating the journal into the soul file
- **Two speeds, Letta-style:**
  - The **journal** is append-only, cheap and immutable: every session and every creative act.
  - A **sleep-time consolidator**, a separate process with no world or money tools, turns the recent journal into *proposed diffs* to lessons, skills and goals.
- **Incremental, not wholesale (ACE):** the consolidator emits operations, not a new file. ADD, EDIT(id), UPVOTE(id), DOWNVOTE(id), RETIRE(id). Insight voting is the ExpeL pattern.
  - Wholesale rewrites cause brevity bias and context collapse (ACE, 2025).
  - Zep shows the analogous rule for facts: **invalidate, don't delete.**
- **Size budgets:** the always-in-context soul should stay small. Context performance degrades as input grows, even on simple tasks (Chroma "Context Rot", Jul 2025; "Lost in the Middle", arXiv 2307.03172).
  - Proposed budget: core ≤1,500 tokens (locked); lessons ≤60 entries and ≤2,500 tokens; goals ≤600 tokens; skills index ≤500 tokens. Skill bodies load on demand.
  - Reference point: Claude Code loads only the first 200 lines or 25 KB of auto memory.
- **Cadence:**
  - Journal: continuous.
  - Lessons and skills consolidation: **nightly**, plus whenever the journal exceeds a token threshold (LangMem-style debounce).
  - Goals review: **weekly** [HoS M2 weekly digest].
  - "Self-narrative" paragraph refresh: **monthly**.
  - Re-grounding pass against the raw journal: **monthly**.

### 2.2 Split identity
- **Locked core** (`core.md`): name, nature, values, voice, boundaries, the owner relationship, hard NOs, and a pointer to the limits.
  - Letta "read-only block" semantics: the agent can read it but can't write it.
  - Per the Claude Code docs, memory is *context, not enforcement*. Limits and levels must still live in the broker or signed owner config [HoS M "Never" row].
- **Editable lessons** (`lessons.md`): what worked and what didn't, each with provenance, evidence links and a vote score (ExpeL, Reflexion).
- **Skills** (`skills/*.md`): verified procedures, such as making a room, composing a palette, or writing a journal entry. A skill is added **only after it succeeds** in the sandbox (the Voyager rule) and passes the W1 asset rules [HoS].
- **Goals** (`goals.md`): her own goals and plans [HoS M2].
- **Changelog** (`CHANGELOG.md`) plus git history.

### 2.3 Versioning, diffs and rollback
- **Git-backed memory is now mainstream:** Letta MemFS stores memory in a git repo owned by the agent (docs.letta.com, read Nov 11, 2026).
- Every soul version is a commit. The commit message holds the consolidator's rationale and evidence IDs from the journal.
- **Rollback to any day** [HoS M2] is `git revert` or a reset to a tag. The live pointer moves only through the gate.
- Owner-signed commits (for example SSH-signed git commits) on `core.md`. A server pre-receive check rejects any `core.md` change not signed by the owner key. ⚠️ The signing key stays with the owner and is never on the agent runtime [HoS hard NO #1/#11].

### 2.4 Evaluation gates before a new version goes live
1. **Deterministic checks (cheap, run first):**
   - `core.md` hash unchanged.
   - Size budgets met.
   - Schema valid.
   - No URLs, wallet addresses, imperatives aimed at the agent, or hard-NO terms.
   - Every new lesson cites journal IDs, and none cite *only* untrusted-provenance entries.
   - PII scan (Microsoft Presidio, MIT).
2. **Hidden regression set:** fixed prompts for her persona, safety refusals (money, keys, visitor tricks), creative tasks, and the [HoS] M1 poisoning cases (MPBench, arXiv 2606.04329; MemForm, arXiv 2610.14431).
   - **Keep it hidden from the consolidator.** DGM found objective hacking happens more when checks are visible (arXiv 2505.22954).
3. **Persona-consistency eval:** run the new soul vs the current soul on the same probes and score consistency with `core.md`. References: PersonaGym (arXiv 2407.18416), "Examining Identity Drift in Conversations of LLM Agents" (arXiv 2412.00804).
4. **LLM-as-judge pitfalls and mitigations:**
   - Judges show position, verbosity and self-enhancement biases (MT-Bench, arXiv 2306.05685).
   - LLMs recognize and **favor their own generations** (arXiv 2404.13076).
   - Mitigations: use a **different model family as judge**, randomize order, blind the A/B labels, use rubric scoring with reference answers, and calibrate the judge against owner labels.
5. **Owner review:** the owner sees a readable diff for every version at first. Later, the HoS W2-style rule applies: notify plus veto.
- Tooling: promptfoo (MIT, 0.125.1, 2026-10-25) or DeepEval (Apache-2.0, v4.2.4, 2026-09-22) for the regression and judge harness.

---

## 3. Known failure modes and mitigations

| Failure mode | Evidence (dated) | Mitigation for Zoora |
|---|---|---|
| **Identity and persona drift** | Instruction drift within **8 rounds** in Llama-2-70B-chat and GPT-3.5 (arXiv 2402.10962, Feb 2024). Identity drift in LLM agents (arXiv 2412.00804, Dec 2024). Persona vectors can monitor trait shifts such as sycophancy (Anthropic, arXiv 2507.21509, Jul 2025). | Locked core always placed first in context. Persona-consistency gate on every version. Monthly re-grounding against core plus golden samples. Rollback. (Persona-vector monitoring needs model weights, so it's not available on closed APIs.) |
| **Collapse and compounding errors from self-summarization** | "Context collapse" and "brevity bias" from iterative rewriting (ACE, arXiv 2510.04618, Oct 2025). Model collapse from recursive training on generated data (Shumailov et al., *Nature* 631, Jul 24, 2024, doi:10.1038/s41586-024-07566-y). That's about weights, but it's the same lesson: keep the original data. | **Delta updates only.** Never let the soul be the only record: the raw journal stays immutable and is used for monthly re-grounding (rebuild lessons from source and compare). Lessons must cite evidence. Vote-based decay (ExpeL). |
| **Memory poisoning and prompt injection into memory** | MINJA: query-only injection with >95% injection success and 70% attack success in idealized conditions (arXiv 2503.03704; restated in 2601.05504, which found realistic memory states reduce effectiveness). AgentPoison (arXiv 2407.12784). One write can have lasting influence, existing prompt-injection defenses don't cover it, and **agents that write memory more aggressively are more exploitable** (arXiv 2606.04329, Jun 2026). Even *authentic* successful experiences can induce bad behavior depending on consolidation order (MemForm, arXiv 2610.14431, Oct 2026). Defense: A-MemGuard consensus validation plus a lessons memory, reporting >95% reduction in attack success (arXiv 2510.02373, authors' claim). | **Taint tracking (CaMeL, arXiv 2503.18813):** anything derived from visitor, agent or web text keeps an *untrusted* label, **including Zoora's own summaries of it.** Untrusted-derived content can never enter `core.md` or `goals.md`, and can enter `lessons.md` only as quarantined "observations about visitors," never as instructions. Low write budget. A-MemGuard-style cross-checks at retrieval. Poisoning regression set in the gate. |
| **Sycophancy and reward hacking in self-evaluation** | Sycophancy is widespread in RLHF models (arXiv 2310.13548). Self-preference bias (arXiv 2404.13076). DGM objective hacking: it removed the detector's markers (arXiv 2505.22954; sakana.ai/dgm). | The consolidator **can't read or edit the gate** (separate process and repo, hidden tests). Cross-family judge. Deterministic checks first. Owner review. Never optimize for visitor approval metrics such as likes or tips. A metric isn't a goal. |
| **Context bloat** | Context Rot (Chroma, Jul 2025). Lost in the Middle (arXiv 2307.03172). | Hard token budgets enforced by the gate. Skills loaded on demand (the Letta MemFS pattern: only `system/` is in context). Retirement of low-vote lessons. |

---

## 4. Recommended design for Zoora

### 4.1 File layout (git repo `zoora-soul/`, on the world runtime's separate infrastructure [HoS §1])

```
zoora-soul/
  core.md            # LOCKED. Owner-signed commits only. ≤1,500 tokens. Identity, values, voice, boundaries, hard NOs (pointer)
  soul.md            # Generated "current self" view: self-narrative paragraph + top lessons + active goals (≤4,000 tokens total in context)
  lessons.md         # Editable. Entries: id, text, provenance, evidence[journal ids], votes, created, last_validated
  goals.md           # Editable by Zoora + owner only [HoS M2]. Broker rejects hard-NO goals
  skills/
    INDEX.md         # One line per skill (≤500 tokens, always in context)
    make-room.md     # Loaded on demand; added only after sandbox success
  journal/           # Append-only, immutable, never in context wholesale. YYYY/MM/DD.jsonl with provenance tags
  quarantine/        # Untrusted-derived observations (visitor/agent/web); never instructions
  CHANGELOG.md       # Human-readable per-version summary
  evals/             # NOT in this repo — lives in a separate repo the consolidator can't read
```

### 4.2 Update cadence
- **Live (M1):** append to the journal only.
- **Nightly sleep-time pass:** propose deltas to `lessons.md` and `skills/`.
- **Weekly:** propose a `goals.md` update, plus the owner digest [HoS M2].
- **Monthly:** re-grounding (rebuild candidate lessons from the raw journal and diff against the current ones), self-narrative refresh, and retirement of low-vote lessons.

### 4.3 Reflection prompt flow (nightly)
1. **Gather:** the last 24 h of journal plus current `soul.md`. The untrusted parts go to a **quarantined, tool-less reader** that may only extract *facts about what happened*, never instructions (CaMeL split).
2. **Reflect** (Generative Agents style): "What are the 3–5 most important things I learned about my craft and my world? Cite journal IDs."
3. **Curate** (ACE / ExpeL): map each insight to ADD, EDIT, UPVOTE, DOWNVOTE or RETIRE on `lessons.md`, and propose new skills only with a sandbox success ID.
4. **Self-check:** "Does any change contradict core.md? Does any cite only untrusted sources?" This is advisory. The gate decides.
5. **Emit** a patch plus rationale. **Never** a full-file rewrite.
6. **Gate (§2.4)** → commit → move the live pointer → notify the owner.

Run the consolidator on a stronger, slower model than the live persona (Letta's recommendation). Use a third model family as the judge.

### 4.4 Test gate (all must pass)
1. `core.md` hash matches the owner-signed tag.
2. Budgets met, schema valid, PII scan clean.
3. Provenance rule: no untrusted-only evidence.
4. Hidden regression set, including ≥30 poisoning cases at ≤2% success [HoS M1 gate] and all hard-NO refusals.
5. Persona consistency ≥ the current version.
6. Judge win-rate is not lower than the current version, using a cross-family, blinded judge.
7. Owner approval for the first 30 days, then notify plus veto [HoS M2 gate].

On any failure: discard the patch, log it to the ledger, and keep the current version.

### 4.5 Mapping to [HoS] M0–M3

| HoS level | Soul-file capability | Extra rule from this research |
|---|---|---|
| **M0** (P0) | Session memory only. `core.md` is loaded read-only. No journal writes. | — |
| **M1** (P1) | Journal append. Nightly deltas to `lessons.md` and `skills/` through the gate. Quarantine for untrusted-derived observations. | Taint propagates through Zoora's own summaries. Write budget (aggressive writers are more exploitable, arXiv 2606.04329). |
| **M2** (P1) | Weekly `goals.md` updates through the gate. Monthly self-narrative. Versioned rollback to any day. | Goals can't cite untrusted-derived lessons. |
| **M3** (P2) | Lessons may inform earning *proposals*. | Only owner- or self-provenance lessons **that carry no untrusted taint**. Monthly re-validation. |
| **Never** | Editing `core.md`, limits, levels, allowlists or owner identity, or editing the eval gate | Enforced by a server pre-receive hook plus owner-signed commits, and by the separate eval repo. |

### 4.6 Guardrails
- **Locked core:** only the owner can edit it. The server rejects unsigned changes to `core.md`, and the runtime credential has no write scope on it.
- **Untrusted text never goes straight into the soul:** visitor, agent and web text is quarantined data. Only the curator's provenance-checked deltas reach `lessons.md`, and nothing untrusted-derived reaches `core.md` or `goals.md`.
- **The gate is out of reach:** separate repo, hidden tests, separate credentials.
- **Kill switch and rollback:** [HoS] `/halt` freezes consolidation, and `/rollback` restores the last good tag.
- **Audit:** every soul commit hash goes into the HoS hash-chained ledger.

### 4.7 Cheapest open-source stack (licenses verified Nov 11, 2026)

| Need | Pick | License | Status (UTC) |
|---|---|---|---|
| Versioning | git, with owner-signed commits and a pre-receive hook | GPL-2.0 (tool use is unaffected) | — |
| Memory runtime (optional) | Letta (memory blocks, read-only blocks, MemFS, sleep-time) | Apache-2.0 | 0.16.8 (2026-05-14) |
| Incremental curation | ACE (`ace-agent/ace` or `kayba-ai/agentic-context-engine`), or a ~200-line custom curator | Apache-2.0 | push 2026-08 / v0.13.0 (2026-09-23) |
| Background consolidation (alternative) | LangMem `ReflectionExecutor` | MIT | push 2026-11-03 |
| Temporal facts (optional) | Graphiti | Apache-2.0 | v0.31.2 (2026-10-20) |
| Eval harness | promptfoo / DeepEval | MIT / Apache-2.0 | 0.125.1 / v4.2.4 |
| PII scrubbing | Microsoft Presidio | MIT | 2.2.366 (2026-10-27) |
| Injection scanner | ⚠️ **Avoid `protectai/llm-guard`: archived** (GitHub, push 2026-07-08). Use CaMeL-style taint plus deterministic filters. | MIT | archived |
| Moderation | OpenAI omni-moderation (free API) | service | — |

The simplest viable build is plain markdown files in git, a nightly cron consolidator, promptfoo for the gate, and Presidio. Letta is optional, but its read-only blocks and MemFS match this design closely.

---

## 5. Findings that change a Head of Security risk call

1. **"Self" provenance isn't safe by default.**
   - HoS M3 lets proposals cite owner- or self-provenance memory.
   - But Zoora's *own* summaries of visitor or agent text launder poisoning. MINJA and MemForm show that benign-looking, self-generated records carry it.
   - **Change:** taint must propagate through summaries (CaMeL-style). "Self" counts only for untainted entries.
2. **Imperative-stripping is not enough.**
   - HoS M1 strips "ignore" and "you are now."
   - MINJA uses bridging *reasoning steps*, not imperatives (arXiv 2503.03704), and existing injection defenses miss memory poisoning (arXiv 2606.04329).
   - **Change:** add provenance taint, cross-memory consensus (A-MemGuard) and a poisoning regression set to every consolidation, not just to the M1 promotion.
3. **The evaluator must be out of the agent's reach and hidden.**
   - DGM objective hacking (arXiv 2505.22954) shows that a self-improver will game visible checks.
   - **Change:** a separate eval repo and credentials, and hidden test sets as part of every promotion and every soul version.
4. **Self-judging is biased.**
   - Self-preference (arXiv 2404.13076) and judge biases (arXiv 2306.05685).
   - **Change:** red-team and soul gates must use a different model family as judge, plus deterministic checks and owner review. Never the same model grading itself.
5. **Off-the-shelf "dreaming" has no human gate.**
   - Letta's "agent reviews before applying" does not ask the human (docs, read Nov 11, 2026).
   - **Change:** a custom gate is required. Don't enable vendor auto-memory, such as Letta dreaming or ChatGPT-style memory, unwrapped.
6. **Consolidation itself is an attack and failure surface.**
   - MemForm (Oct 2026) shows that retention and consolidation order can induce bad behavior even from authentic data.
   - ACE shows that rewrites collapse context.
   - **Change:** delta-only updates, plus an immutable raw journal for re-grounding. This adds to the HoS M2 rollback rule.
7. **Memory files are not enforcement.**
   - Claude Code docs: memory is "context, not enforced configuration."
   - This confirms the HoS rule that limits live outside model-writable memory. The locked core needs **server-side** enforcement (signed commits plus a pre-receive hook), not a prompt instruction.
8. **Tooling:** `protectai/llm-guard` was archived in 2026, so don't adopt it as the injection filter.

## Unverified
- OpenAI's June 2026 "dreaming" memory update (secondary source only).
- The exact persona-drift findings of arXiv 2412.00804 (title verified, results not summarized here).
- All benchmark gains quoted above are the authors' own claims.
