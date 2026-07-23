# Damopool Engineering Organisation — Version 2.0 (Design Proposal)

> **Status: RESOLVED, 2026-07-23.** This draft sat unreviewed through the entirety of Phase E — itself
> a governance gap, named in `docs/PHASE_E_POSTMORTEM.md` Section 9. It has now been resolved
> item-by-item against Phase E's own evidence rather than left open any longer; the full disposition
> table is in `docs/PHASE_E_POSTMORTEM.md` Section 13. Summary: Targeted Re-Review (Part 8), per-stream
> log staging (Part 9), Test Engineer pre-screening, and Mandatory Context Justification (Part 3) are
> **adopted** and are now written into `DEVELOPMENT_PROCESS.md` v2.0. Architecture/Design System Digests
> (Parts 2.1–2.2) are **approved for a pilot only**, not general reliance. Technical Secretary, the
> Engineering Dashboard, and Versioned Engineering Memory are **deferred** — no track record yet exists
> to justify them. A third+ concurrent parallel stream and a literal multi-stage review pipeline are
> **rejected** for now. This file's substantive content below is preserved unchanged as the historical
> record this analysis was actually based on; it is no longer an open proposal awaiting a decision.

## 0. Purpose and Relationship to Existing Governance

This document proposes changes to *how* the Damopool engineering
organisation operates — not to *what* it is accountable for.
`ENGINEERING_ORGANISATION.md`'s role definitions, `DEVELOPMENT_PROCESS.md`'s
workflow and quality gates, and every item in `DEVELOPMENT_PROCESS.md`
Section 5's Permanent Human Governance list are unchanged by this proposal
unless a specific section below says otherwise, and any such change is
called out explicitly, not implied.

Every recommendation in this document is grounded in evidence from the
*Feature 007 Engineering Efficiency & Token Utilisation Report* (v1.0),
cited throughout as "the Efficiency Report." Where a recommendation is not
directly supported by that report's data, this document says so — the
brief for this exercise was explicit that expensive engineering work may
still represent excellent value, and that optimisation is only warranted
where evidence supports it. Several ideas suggested by the brief's own
structure are evaluated and *not* recommended, for stated reasons — see
Part 7 in particular.

## 1. Root Cause Analysis

Every cost identified in the Efficiency Report has a cause. Some are
structural and effectively unavoidable under the current delegation model;
others are avoidable without touching that model at all. Conflating the
two would risk "optimising" a cost that is actually the price of
independent review — exactly what this exercise was warned against.

| Cause | Necessary or avoidable | Why |
|---|---|---|
| Repeated full-document reading (`ARCHITECTURE.md`, `DESIGN_SYSTEM.md` read 6–8 times each across dispatches, Efficiency Report Part 6 #2) | **Structurally necessary in kind, avoidable in degree** | Each subagent dispatch is a fresh agent with no memory of any prior dispatch — this is a real platform property, not a policy choice. Some re-grounding in source truth is unavoidable. But re-reading the *entire* document from scratch every time, rather than a targeted subset, is not required by that constraint — it is a task-framing choice. |
| Round-2 (re-verification) passes costing as much or more than Round 1 (Architecture: 21 vs. 13 tool uses; Milestone 2: 19 vs. 10) | **Avoidable** | A re-verification dispatch was asked to "re-review the fixed document/file," not "verify these specific N claimed fixes against these specific N findings." It had no reason to be cheaper than the original pass, because it was not told what would make it cheaper. |
| Repeated repository exploration (reviewers independently re-establishing "is this actually committed, is this actually approved" via fresh `git`/`PROJECT_LOG.md` reads) | **Avoidable** | No standing artifact currently answers this in one place; each reviewer reconstructs project state from a chronological narrative log that grows every entry. |
| Repository bookkeeping overhead (the `PROJECT_LOG.md` split-and-restore needed to keep Milestone 4's commit self-contained from the concurrently-developed Shared Components stream) | **Avoidable** | A single shared, chronologically-appended log file has no way to represent "these lines belong to stream A, these to stream B" except manual surgery at commit time. This is a file-structure limitation, not a review-discipline one. |
| Engineering Manager role-switching (Architecture Lead → Frontend Lead → reviewer-of-subagent-output → Documentation Engineer, often within one turn) | **Necessary, given the current organisation** | `ENGINEERING_ORGANISATION.md` §2 explicitly folds every delegatable role without its own agent into the EM. This cost is not hidden or accidental — it is the direct, known consequence of that structure, and the alternative (a dedicated agent per role) trades it for more dispatch overhead, not less. |
| Approval administration (Human Approval Brief production, per-milestone commit/push confirmation) | **Necessary in substance, avoidable in mechanics** | The approval gate itself is non-negotiable — inherited unconditionally from existing governance, not something this document grants or could withdraw. The *drafting labour* of assembling a brief from already-known facts is separable from the judgement of deciding what belongs in it. |
| Documentation administration (writing `PROJECT_LOG.md`'s long narrative entries) | **Necessary in substance, avoidable in mechanics** | Same shape as approval administration — deciding *what* is significant enough to record is judgement; writing the paragraph is not. |
| Waiting between dependent activities (e.g., Node/nvm install blocking further JS testing until resolved) | **Necessary** | A real dependency existed; no amount of process redesign removes the need to wait for it. The only lever available is *deciding faster* whether a blocker needs a Human decision (Part 3's escalation criteria address this directly). |

**Ranked by expected engineering benefit** (not raw token size — several
of these are individually small in tokens but zero-risk and immediately
actionable, which the brief asked to be weighed above raw size):

1. **Targeted, findings-anchored re-verification** (Part 8) — highest
   ranking. Directly evidenced by the two paired rounds where Round 2 cost
   *more* than Round 1, has essentially no quality downside if done
   correctly (the reviewer still sees exactly what changed), and is
   immediately actionable with no new tooling.
2. **Per-stream log staging** (Part 9) — fully avoidable, mechanical, zero
   quality trade-off, directly evidenced by this feature's own commit
   history needing a manual fix.
3. **Test Engineer pre-screening before dispatch** (already in the
   Efficiency Report, restated here) — small in absolute tokens (~19,500)
   but 100% of that spend was waste by definition (two declines, zero
   output), and the fix costs nothing beyond a habit.
4. **Reusable knowledge artifacts (digests, contracts, standards)** (Part
   2) — potentially the largest saving, but carries the largest genuine
   risk (staleness causing a reviewer to miss something a full read would
   catch), so it is ranked below the zero-risk items above despite a
   plausibly larger token number.
5. **Administrative offload (Technical Secretary)** (Part 5, 6) — real,
   evidenced (the Efficiency Report itself needed a dedicated fork to
   reconstruct data a running artifact would have made trivial), but
   lower urgency than 1–3 since it improves EM throughput rather than
   fixing an active, measured cost.

## 2. Engineering Information Architecture

Ten artifacts, not eleven — the brief's example list included "Current
Interfaces" and "API Contracts" as separate items; this design treats them
as the same artifact under one name, since inventing an artificial
distinction between them would itself be the kind of unjustified
complexity this exercise is meant to avoid.

For every artifact: the update rule is deliberately conservative wherever
staleness would be dangerous. None of these are hand-summarised
free-standing documents that can silently drift from the truth they
describe — each is either mechanically derived from a real source file, or
explicitly an *index into* an existing source of truth (pointing at it,
not replacing it).

### 2.1 Architecture Digest

- **Purpose:** let a role determine, in a few hundred tokens, *which*
  `ARCHITECTURE.md` sections are actually relevant to its task, before
  deciding whether the full ~8,000-token document is needed.
- **Owner:** Architecture Lead (EM).
- **Consumers:** Code Reviewer, Test Engineer, any delegated implementer.
- **Maximum size:** one line per section (25 sections) — target under 60
  lines / ~2,000 tokens.
- **Update rule:** mechanically regenerated from `ARCHITECTURE.md`'s own
  section headers and opening sentence whenever the source file changes —
  never independently authored, to prevent the digest and the document it
  summarises from silently diverging in meaning.
- **Refresh trigger:** any commit touching `docs/ARCHITECTURE.md`. This
  project has no CI to enforce that mechanically — regeneration is
  discipline, not an automated guarantee, the same honestly-disclosed
  limitation as API Contracts (2.4), whose CI gap and this digest's
  identical one are both named together as a Long-term, unsolved item
  in Part 12. This is the specific mechanism behind Part 13's "digest
  staleness" risk: a discipline lapse here is how it would actually
  occur.
- **Versioning:** none of its own — it carries the source document's
  version implicitly, by construction.
- **Expected benefit:** directly targets Part 1's first root cause
  (repeated full-document reading).
- **Expected token reduction:** `[ESTIMATE]` most Feature 007 review
  dispatches genuinely needed 2–4 of 25 sections; a working digest could
  plausibly cut Architecture-reading cost specifically by 40–60% — not
  validated, since no digest has been built or tried yet (see Part 12).

### 2.2 Design System Digest

Same purpose, ownership, and update discipline as 2.1, scoped to
`docs/DESIGN_SYSTEM.md`'s 15 sections (colour tokens, type scale, spacing,
and the eleven-part component list summarised as one line each).

### 2.3 Coding Standards

- **Purpose:** stop restating the same conventions inside every delegation
  prompt. Direct evidence this gap exists: the Shared Components
  delegation prompt had to manually restate "match the existing code
  style exactly: ES modules, `export function`, minimal comments... no
  JSDoc blocks" — conventions that had already been established and
  followed consistently across four prior modules, but existed nowhere as
  a single reference.
- **Owner:** EM.
- **Consumers:** every implementer, delegated or not.
- **Maximum size:** under one page.
- **Update rule:** append-only; a convention is added only once it has
  actually been established by a real decision or review finding (e.g.
  "use `Number.isFinite(x)`, not `typeof x !== 'number' || Number.isNaN(x)`"
  — a pattern that emerged from a genuine Milestone 2 finding), never
  speculatively.
- **Expected benefit:** high confidence — the gap is directly evidenced,
  not hypothesised.
- **Expected token reduction:** `[ESTIMATE]` small per-dispatch (a
  paragraph of prompt text), but recurring on every future delegation.

### 2.4 API Contracts (incorporates "Current Interfaces")

- **Purpose:** let a new milestone building on existing modules
  (`core/format.js`, `core/errors.js`, `core/state.js`, `core/router.js`,
  `core/api.js`, `core/dom.js`, `components/*.js`) know exactly what it
  can call without reading each source file in full.
- **Owner:** whichever Lead most recently touched the interface.
- **Consumers:** Code Reviewer (fidelity check against actual exports),
  future implementers.
- **Maximum size:** one exported signature plus one line of purpose per
  export — no implementation detail.
- **Update rule:** updated in the *same* commit as any change to a
  module's exports. This project has no CI to enforce that mechanically —
  named explicitly as a Long-term, unsolved item in Part 12, not glossed
  over.
- **Refresh trigger:** any commit touching a `core/` or `components/`
  file's `export` statements.

### 2.5 Current Milestone Brief

- **Purpose:** give any role — subagent or EM returning after a context
  gap — instant orientation on exactly what is in flight and its scope
  boundary. This formalises something already being hand-authored: every
  delegation prompt this feature already stated explicit inclusions and
  exclusions (e.g. "do not touch any file outside `frontend/src/components/`
  ... do not build DataTable, SearchBox, TickerFeed, or ChartPanel").
- **Owner:** EM.
- **Consumers:** delegated implementers, reviewers checking scope
  adherence.
- **Maximum size:** about one page.
- **Update rule:** rewritten, not appended, at the start of each
  milestone/stream; retired into Review History (2.9) when the milestone
  closes.
- **Expected benefit:** high confidence — this is already done manually,
  every time; formalising it means writing it once per milestone instead
  of recomposing it inside every prompt that touches that milestone.

### 2.6 Dependency Graph

- **Purpose:** make the "what can run in parallel, what must be
  sequential" analysis a standing artifact instead of re-derived prose.
  Direct precedent: the actual analysis performed before Milestone 4 ("API
  Layer depends only on `errors.js`/`state.js`... Shell and Components
  depend on the CSS foundation and `format.js`... Charts needs an actual
  rendering context").
- **Owner:** Architecture Lead (EM).
- **Consumers:** EM (stream allocation), Human (visibility into what is
  blocked on what).
- **Maximum size:** a small table — module, depends-on, status.
- **Update rule:** updated whenever a module completes or a new one is
  planned.
- **Expected benefit:** `[ESTIMATE]` medium — real, but this analysis has
  only happened once so far in Feature 007, so the direct token saving to
  date is small; its value is mostly in preventing a future
  wrongly-assumed-independent parallel pair.

### 2.7 Known Decisions

- **Purpose:** let a reviewer check "has this already been settled"
  without reading the entire chronological `PROJECT_LOG.md`. This is an
  *index into* `PROJECT_LOG.md`, not a replacement for it — the reasoning
  stays in one place (the log), this artifact only makes it findable.
  Directly implements `DEVELOPMENT_PROCESS.md` §4's existing Approval
  Memory principle, which today lives only implicitly inside prose.
- **Owner:** EM, drafted by Technical Secretary from EM-supplied facts
  (Part 6).
- **Consumers:** everyone.
- **Maximum size:** one line plus a `PROJECT_LOG.md` date/entry pointer,
  per decision; grows over time, append-only.
- **Update rule:** a line is added whenever `PROJECT_LOG.md` records a
  "Design Completed" or otherwise-settled decision. Never edited — a
  reversed decision gets a *new* line noting the reversal and pointing to
  the new entry; the old line stays, for history.

### 2.8 Known Limitations

- **Purpose:** same index-not-source pattern as 2.7, for "carried
  forward, not blocking" items. The Efficiency Report's own Part 4
  identified roughly ten of these across Feature 007 — as of this
  writing, still-open examples include colour-blindness simulation of
  the chart palette, the theme-flash-on-load interaction, and
  `createRouter`'s DOM wiring remaining untested by design; the icon-CSS
  gap has since become the largest single item. (Non-text border
  contrast was flagged during the Design System review's round 1 and
  was resolved and re-verified in round 2 of that same review — it is
  not a current example; this artifact's whole purpose is to keep that
  distinction accurate as items are opened and closed, which this
  document's own worked example in Part 10 failed to do once, corrected
  there.) This artifact is exactly the "tracked, not left implicit"
  mechanism the icon-CSS gap was explicitly asked for.
- **Owner:** EM, drafted by Technical Secretary from EM-supplied facts
  (Part 6).
- **Consumers:** everyone.
- **Update rule:** added when a finding is explicitly carried forward
  rather than fixed; marked resolved (not deleted) when later closed.

### 2.9 Review History

- **Purpose:** a structured (not prose) record of every review round —
  milestone, round number, reviewer, verdict, finding counts by severity,
  date. This is, concretely, what had to be manually reconstructed by a
  dedicated extraction pass to produce the Efficiency Report at all. A
  running Review History would have made that report close to free to
  produce.
- **Owner:** EM, drafted by Technical Secretary from EM-supplied facts
  at the close of each review round (Part 6).
- **Consumers:** EM, Human, future efficiency analysis.
- **Expected benefit:** high confidence for any future reporting or
  retrospective task specifically; direct evidence already exists (this
  very exercise).

### 2.10 Current Risks

- **Purpose:** a short, live list of open risks, so they are not
  re-discovered by prose search each time. Real, current examples:
  `analytics_builder.py` still has no cron schedule (open since the
  original, superseded Feature 007 design session); `analytics.json` is
  not exposed via Nginx; the JS-runtime gap (now resolved — an example of
  an item that should be marked closed once addressed, not left stale).
- **Owner:** EM, drafted by Technical Secretary from EM-supplied facts
  (Part 6).
- **Consumers:** everyone, Human especially.
- **Update rule:** added when discovered, marked resolved (not deleted)
  when closed.

## 3. Mandatory Context Justification

**The policy.** Before any subagent dispatch reads a document, the
dispatching prompt must state: which document, why it is required, which
sections specifically, whether a digest (Part 2) is sufficient, and — only
if not — why the full document is genuinely necessary.

**An honest limitation, stated rather than glossed over:** this policy is
straightforwardly enforceable for *dispatched* roles, because the EM
writes their prompt and can require the justification to be present in it
before dispatch. It is **not** independently enforced for the EM's own
reading, since nothing external checks the EM's internal document access
the way a subagent's prompt can be checked before it is sent. For the
EM's own role-switching, this is a discipline commitment, not a verified
control — the same asymmetry the Efficiency Report's Part 3 raised for a
related reason (the EM cannot rate its own engineering value with the
same evidence standard applied to delegated roles). That report was
published as a standalone Artifact, not committed to this repository, so
this citation cannot be independently re-verified against a file the way
every other citation in this document can — noted here rather than
presented as equally checkable.

**What already worked, and should simply be made consistent.** Most
Feature 007 dispatches already specified particular sections rather than
"read the whole document" — this policy formalises an already-mostly-good
practice and catches the exceptions, rather than fixing something broken
from nothing.

**Escalation criteria** — a full-document read is justified only when:
1. The targeted sections and any available digest do not answer a
   specific, statable question the role needs answered.
2. A cross-reference inside a targeted section points to unlisted
   material that is load-bearing for the finding under investigation.
3. The role is reviewing the first-ever instance of a new document or
   pattern, for which no digest yet exists — this criterion is what
   would trigger building one, which then follows the Medium-term
   pilot-before-reliance gate defined in Part 12.

**Stopping criteria.** Once the specific question that justified the
escalation has been answered, the read stops — "while I'm here" continued
reading is exactly the pattern this policy exists to prevent.

## 4. Role Review

The brief was explicit: optimise for clearer responsibilities, not for
fewer roles. No role below is eliminated.

| Role | Recommendation | Evidence |
|---|---|---|
| Engineering Manager | **Retained**, with a slice of administrative output recommended for delegation to Technical Secretary (Part 5, 6) | See Part 5's judgement/administration split |
| Architecture Lead | **Retained**, expanded by one small deliverable (owns the Architecture Digest, Part 2.1) | No authority change, one new artifact-maintenance duty |
| Frontend Lead | **Retained.** For well-bounded implementation tasks, continue delegating to a general-purpose agent | Efficiency Report rated the Shared Components delegation High value: 55/55 tests passing on first execution, strict scope adherence, five of six self-reported design decisions confirmed reasonable on review |
| Backend Lead | **Retained, unchanged** | No distinct exercise of this role has occurred yet in Feature 007 (all backend-adjacent work folded into EM) — insufficient evidence to recommend any change, so none is proposed |
| Documentation Engineer | **Retained**, with the mechanical write-up slice recommended for Technical Secretary, keeping the judgement of *what* is significant enough to record with Documentation Engineer/EM | This document's Part 1: "documentation administration" identified as a real, separable cost |
| Release Manager | **Retained, unchanged in authority.** Brief-boilerplate and commit-message drafting recommended for Technical Secretary; the approval gate and the actual git operations are untouched | Already a fairly mechanical sequence (propose → wait for Human approval → execute); no evidence its judgement content is large |
| Code Reviewer | **Retained exactly as is — scope and dispatch pattern unchanged.** The only recommended change is external: better-scoped *input* on Round 2+ passes (Part 8), not a change to the role | Efficiency Report: Very High value rating, zero confirmed false positives, "well-balanced... not over-analysing" across all ten dispatches — direct evidence against reducing its use |
| Test Engineer | **Retained, unchanged.** Recommended fix is upstream (EM pre-screens before dispatch), not to the role's own charter | Both declines in Feature 007 were correctly-reasoned identifications of the agent's actual scope boundary — the inefficiency sits in task framing, not agent judgement |
| Delegated Frontend Lead (general-purpose pattern) | **Formalised, not expanded in authority** — documented as a repeatable delegation template for well-bounded tasks, used more deliberately when a task genuinely qualifies | High value rating; clean scope adherence independently verified by EM before proceeding to review |

## 5. Engineering Manager — Judgement vs. Administration

**Requires engineering judgement (retained with EM, not delegable):**

- Architecture and design decisions.
- Deciding what requires Human approval versus what is within EM's own
  authority (`DEVELOPMENT_PROCESS.md` §3 is unchanged by this document).
- Deciding milestone scope and sequencing, and dependency-graph-based
  stream allocation.
- Deciding what counts as a "genuine engineering issue" worth breaking
  established scope for.
- Evaluating subagent findings and deciding which fixes to make.
- Deciding when a delegated implementer's self-report needs independent
  re-verification, and performing that verification (evidenced directly:
  the Shared Components stream's 55/55 self-report was re-run and
  re-confirmed by the EM before proceeding, exactly the discipline this
  item describes).

**Administrative (candidates for delegation to Technical Secretary, Part 6):**

- `PROJECT_LOG.md` entry drafting — writing up a decision the EM has
  already made, not making it.
- `ROADMAP.md` non-status text upkeep — the Status field itself remains
  Human-only per existing governance, untouched here.
- Human Approval Brief assembly from EM-supplied facts.
- Commit-message drafting from an EM-supplied change summary.
- Milestone tracking / Dashboard upkeep (Part 10).
- Review-statistics tallying — precisely the manual reconstruction work
  the Efficiency Report itself required a dedicated fork to perform.

**Estimated workload reduction:** `[ESTIMATE, low confidence]`. Based on
a rough sense of how much of the EM's own output in Feature 007 was
narrative write-up versus design/review-fixing decisions, perhaps
30–40% of total EM output volume is administrative in this sense.
Offloading it — with EM still reviewing every draft before it is
finalised — could plausibly free 20–35% of EM effort for
judgement-heavy work. This is the least well-evidenced estimate in this
document; there is no measured baseline to check it against.

## 6. Technical Secretary — Proposed New Role

**Recommendation: yes, introduce this role**, on the strength of direct
evidence: producing the Efficiency Report itself required a dedicated
data-extraction pass because no running record of review statistics
existed; documentation administration was independently identified in
this document's Part 1 as a real, separable cost; and Part 5's
judgement/administration split gives it clear, bounded responsibilities
that do not overlap with any existing role's actual decision-making
authority.

- **Responsibilities:** draft `PROJECT_LOG.md` entries from EM-supplied
  facts; maintain `ROADMAP.md`'s non-status text; assemble Human Approval
  Briefs from EM-supplied findings and outcomes; draft commit-message
  boilerplate from an EM-supplied change summary; maintain the Engineering
  Dashboard (Part 10); maintain the Review History, Known Decisions, Known
  Limitations, and Current Risks indices (Part 2); draft release notes.
- **Authority: none beyond drafting.** Cannot approve, decide, commit,
  push, or mark anything Completed. Every output is a draft the EM (and,
  where governance requires it, the Human) must review before use. This
  is stated explicitly and without exception, so the role cannot become a
  shadow-authority that erodes the Human Approval principle this proposal
  preserves unconditionally throughout (see §0; `DEVELOPMENT_PROCESS.md`
  §5's Permanent Human Governance list is unaffected by this role).
- **Inputs:** EM-supplied facts only. Never independently gathers or
  interprets engineering facts — only formats and files what it is given.
- **Outputs:** the drafts listed above.
- **Interaction with EM:** EM supplies raw facts → Secretary drafts → EM
  reviews, edits, and approves → Human approves wherever existing
  governance already requires it.
- **Is this a new tool-enforced agent, or a delegatable role?** A
  **delegatable role**, performed by the EM directly or delegated to a
  general-purpose agent for a bounded formatting task — matching exactly
  how Backend Lead, Frontend Lead, Documentation Engineer, and Release
  Manager already work under the current organisation. This avoids the
  heavier governance step of defining a new tool-enforced agent (which
  `DEVELOPMENT_PROCESS.md` §5 already reserves for Human approval) before
  the role has any track record. It can be promoted to a dedicated agent
  later if evidence justifies it, the same upgrade path already built
  into the existing organisation's design.
- **Expected benefit:** frees EM capacity per Part 5; is the direct
  enabler of the Review History and Dashboard artifacts, whose value is
  partly independent of token savings — it is an information-flow
  improvement, one of this proposal's stated objectives in its own right.
- **Expected token reduction:** `[ESTIMATE]` modest on its own — formatting
  is not the dominant identified cost, repeated document reading is — but
  it is a prerequisite for artifacts (2.9, Part 10) that other savings
  depend on.

## 7. Review Pipeline — What the Evidence Actually Supports

The brief's example structure (Architecture Compliance, Correctness,
Security, Testing, Documentation, Performance as separate stages) is
evaluated here and **not recommended as a literal multi-dispatch
pipeline.** This section explains why, since "challenge existing
assumptions" was an explicit instruction and a template-shaped answer
would not do that.

**What actually happened in Feature 007, and what it shows.** Code
Reviewer performed all of these dimensions — architecture fidelity,
correctness, security (the XSS/`textContent` requirement), documentation
cross-reference accuracy, and test-quality assessment — in *one combined
dispatch* per review round, and the Efficiency Report rates the result
Very High value with zero confirmed false positives. Splitting this into
separate stage-dispatches would very likely **increase**, not decrease,
the repeated-document-reading cost that Part 1 identifies as the real
problem — every additional stage is another fresh agent re-establishing
the same context. It also risks a finding falling into the gap between
stages: the Shared Components `badge.js` finding, for instance, was
simultaneously a correctness issue and a design-system-fidelity issue: a
"Correctness" stage and a separate "Architecture Compliance" stage could
each have assumed the other would catch it.

**What did work, and should be formalised.** Design System's contrast-math
check (Test Engineer, dispatched in parallel with Code Reviewer's broader
pass) is a genuine, evidenced example of *useful* staging: it was a
self-contained, mechanically-verifiable sub-claim that did not need the
broad context Code Reviewer required, so splitting it off cost nothing
and added independent, from-scratch verification of a specific formula.

**Proposed design:**

1. **Combined Review** (Code Reviewer, single dispatch) — **always
   executes.** Covers architecture compliance, correctness, security, and
   documentation fidelity as one integrated pass, exactly as practised
   successfully throughout Feature 007. Never split by default.
2. **Mechanical Verification** (Test Engineer or a self-contained script)
   — **conditional**, triggered only when *all* of the following hold,
   checked by the EM before dispatch: (a) the milestone contains a
   specific, statable claim reducible to a formula or numeric
   derivation (not "is this good code," but "does this specific
   computation produce this specific result"); (b) that claim can be
   independently re-derived from first principles rather than merely
   re-reading the same numbers the implementation already asserts; (c)
   verifying it does not require the broad architectural/design context
   Combined Review already carries. All three held for the Design
   System's contrast-math check; none of the three held for Milestones
   1 through 4, which is why this stage did not run for them.
3. **Deep Performance Review** — **conditional, not yet exercised.**
   Triggered only when a milestone explicitly does one of: introduces a
   rendering path expected to run at real scale (many DOM nodes, a
   live-updating chart); introduces a polling or network path where
   latency is part of the feature's own correctness (not just its
   pleasantness); or is flagged by Combined Review as having a
   plausible performance concern it could not fully assess within its
   own pass. No milestone in Feature 007 to date has met any of these
   three triggers — this is stated as a dormant, not-yet-validated
   stage, not something already proven.
4. **Testing** is not a separate stage — it is folded into Combined
   Review's own checklist (evidenced: multiple Code Reviewer reports in
   this feature explicitly assessed test genuineness and coverage as part
   of one pass), unless a milestone's testing is itself complex enough to
   warrant a dedicated pass — same conditional logic as stage 2.

**Early termination:** a Blocking finding from Combined Review halts
everything downstream until fixed and re-reviewed — already the practised
rule (Code Reviewer is never dispatched against known-broken code).

**Finding merging / duplicate prevention:** in practice, Code Reviewer and
Test Engineer's Feature 007 dispatches never raised the same finding —
because their scopes were non-overlapping by design (broad qualitative
review vs. narrow computational check), not because of any deduplication
mechanism. This design keeps that as an explicit rule: stage 2 (Mechanical
Verification) only runs on ground that stage 1 (Combined Review) was
never asked to cover.

## 8. Targeted Re-Review

**Design.** A re-verification dispatch (any Round 2+) receives: the
specific findings list from the prior round, and a diff (or an explicit
list of changed files/functions) — not an instruction to "re-review the
file." Review begins with what changed, the regression tests added for
each finding, and any updated interface signatures.

**Escalation criteria** — widen beyond the diff only when:
1. The diff touches an interface documented in API Contracts (2.4) as
   depended on by already-shipped code — escalate to checking those
   callers specifically, not the whole codebase.
2. The diff touches a security-relevant boundary (untrusted-input
   handling, the XSS-safety `textContent` path, the fetch/cache boundary)
   — evidenced as exactly where this feature's real Major findings
   clustered (the `loading-skeleton.js` style-injection surface, the
   `badge.js` silent-fallback risk).
3. The targeted read surfaces something that does not make sense without
   broader context — the same "escalate only when the narrow read cannot
   answer a real question" logic as Part 3.
4. This is the **first** implementation of a new module or pattern with
   no prior full review to build on (router.js and api.js's *first*
   reviews were correctly full reviews — this criterion does not apply to
   Round 1 passes, only distinguishes when a Round 2+ pass may legitimately
   need to widen).

**Stopping criteria.** The reviewer has verified each claimed fix against
its specific finding, one-to-one; confirmed no new findings in the touched
lines; and does not re-verify code the prior full review already
established as correct and untouched by the fix — consistent with
`DEVELOPMENT_PROCESS.md` §4's existing principle that settled decisions
are not re-litigated.

**Protecting quality.** The findings list travels *with* the diff, not
instead of it — the reviewer verifies the exact claimed fix, rather than
guessing what changed from the diff alone.

**The test for whether this is actually working, going forward:** a
properly targeted Round 2 dispatch should use *fewer* tool calls than its
Round 1 counterpart, since Round 1 must discover everything from scratch
and Round 2 only verifies specific claims. Two of the three paired rounds
measured in the Efficiency Report show the opposite (Architecture: 21 vs.
13; Milestone 2: 19 vs. 10) — that inversion is the concrete signal this
design is meant to reverse. If a future Round 2 still costs more than
Round 1 after this design is adopted, that is evidence the targeted-review
discipline is not being followed, not evidence the discipline doesn't
work.

## 9. Parallel Engineering

**When streams should branch.** When the Dependency Graph (2.6) shows zero
shared files/modules between two candidate streams, and neither depends on
an output the other has not yet produced — the exact criteria informally
applied to Milestone 4 (API Layer) and Shared Components, which touched
disjoint file sets (`core/api.js`/`api.test.js` vs. `components/*`,
`dom.js`) and had no interface dependency on each other.

**When streams should converge back to sequential.** When a new milestone
depends on outputs from *both* prior streams — a real, near-term example:
a future Application Shell / Dashboard milestone will depend on both
`api.js` and the Shared Components, meaning it must wait for both to be
individually approved and committed first, not start until then.

**Dependency analysis.** Performed by the EM (Architecture Lead), written
down using the Dependency Graph artifact before any stream is allocated —
already the practice; this formalises it as a standing document instead
of one-off prose.

**Maximum recommended concurrent streams: 2, pending further evidence.**
The EM is a single reasoning process even though subagents run as
background tasks — the limit is not dispatch capacity but how many
independent review-and-fix-and-commit cycles can be tracked, scoped, and
kept separated without error. Feature 007's only tested configuration is
exactly two concurrent streams. There is no evidence for three or more;
this document recommends trying a third only after two has been repeated
successfully at least once more (Part 12).

**Isolation.** Reviews, commits, and documentation all remained correctly
isolated in the one tested case — but the documentation isolation required
manual, ad hoc line-surgery on `PROJECT_LOG.md` at commit time. This
proposal formalises **per-stream log staging**: each parallel stream
accumulates its own draft log section (physically separate, e.g. a
temporary per-stream file or a clearly delimited draft block), merged into
the canonical `PROJECT_LOG.md` only at that stream's own commit — removing
the need for the split-and-restore maneuver entirely, addressing Part 1's
"repository bookkeeping overhead" row directly.

**Conflict avoidance.** The Dependency Graph check *is* the conflict-avoidance
mechanism: two streams touching the same file are never run in parallel.
Correctly followed in the one tested case; stated here as a hard rule
rather than an incidental outcome.

## 10. Engineering Dashboard

Mandatory at the start of every milestone, per the brief. Below is the
design, populated with Feature 007's actual current state as a worked
example — proving the design against real content rather than a
hypothetical mock.

**Design principle:** the Dashboard is a *rollup*, not a new source of
truth. Every field aggregates from Review History, Known Limitations,
Known Decisions, the Dependency Graph, or the actual `git`/test-suite
state — it never originates a fact that doesn't already exist somewhere
else, to avoid creating an eleventh place engineering facts can silently
drift out of sync with reality.

**Owner:** Technical Secretary (drafts), from EM-supplied and
mechanically-checkable facts. **Location:** `ENGINEERING_DASHBOARD.md`
(root), mirroring `PROJECT_LOG.md`/`ROADMAP.md`'s existing location.

| Field | Current value (worked example, 2026-07-17) |
|---|---|
| Overall Feature Progress | Feature 007 "Damopool Website" — Phase D (Implementation) in progress; Phases A/B/C complete and approved |
| Current Milestone | None active (paused for the Efficiency Report and this V2.0 design exercise) |
| Completed Milestones | Architecture, Design System, Milestone 1 (CSS Foundation), Milestone 2 (Core JS Utilities), Milestone 3 (Router), Milestone 4 (API Layer), Shared Components — 7 units |
| Parallel Streams | None currently active |
| Queued Work | Application Shell (now unblocked — Components approved), Charts (blocked on ECharts + a real rendering context) |
| Current Reviews | None in progress |
| Current Risks | `analytics_builder.py` has no cron schedule (open since original Feature 007 design session); `analytics.json` not exposed via Nginx; icon CSS does not exist yet (tracked, blocks visual completeness of the delivered components) |
| Known Limitations | Chart-palette colour-blindness simulation unverified; theme-flash-on-load interaction unresolved; `createRouter`'s DOM wiring untested by design; icon CSS does not exist yet (see Current Risks, above) |
| Commits | 7 Feature-007 commits (`13d7f2c`…`e78b7f9`), all pushed |
| Push Status | Up to date, 0 ahead/behind `origin/master` |
| Frontend Test Count | 176 (`node --test`, measured) |
| Backend Test Count | 273, 1 documented expected failure (measured) |
| Review Statistics | 10 Code Reviewer passes, 78 findings (0 Blocking / 22 Major / 56 Minor); 4 Test Engineer dispatches, 2 declined |
| Token Statistics | 984,777 measured subagent tokens (Efficiency Report) |
| Engineering Health | Green — all committed work reviewed and approved; one tracked cross-cutting gap (icon CSS) pending a future milestone |
| Dependency Status | CSS Foundation → Core JS Utilities → Router (sequential) → {API Layer, Shared Components} (the one tested parallel pair, Part 9 — both shipped) → Application Shell (unblocked) → Dashboard/Pages (blocked on Shell) → Charts (blocked on rendering context) |

## 11. Versioned Engineering Memory

**Distinct from Part 2's artifacts, not a duplicate of them.** Part 2's
Known Decisions/Known Limitations/Coding Standards are lightweight,
continuously-updated working documents — appending a line requires no
formal gate. Engineering Memory is a smaller, **formal, versioned,
approval-gated subset**: the decisions and conventions meant to be stable
and binding going forward. A convention gets "promoted" from Coding
Standards into formal Engineering Memory once it has been applied
consistently three or more times — a concrete, checkable promotion
criterion, not a vague one.

This formalises `DEVELOPMENT_PROCESS.md` §4's existing Approval Memory
concept into its own structured artifact, rather than leaving it
implicit inside `PROJECT_LOG.md` prose, as it is today.

**Entry format:**

```
### [ENTRY-ID] Title
Version: 1.0
Owner: <role>
Source: PROJECT_LOG.md YYYY-MM-DD entry | ARCHITECTURE.md Section N | Human instruction
Approval state: Approved by Human on YYYY-MM-DD | Provisional (EM-only)
Consumers: <roles/milestones that depend on this holding true>
Expiry: Permanent | Superseded by [ENTRY-ID] | Re-evaluate if <condition>
```

**Worked examples, using real Feature 007 decisions** (proving the format
against actual content, not inventing hypothetical entries):

```
### [EM-001] No JavaScript framework
Version: 1.0
Owner: Architecture Lead
Source: docs/ARCHITECTURE.md Section 3.1
Approval state: Approved (Phase A/B Human Approval Brief)
Consumers: every frontend milestone
Expiry: Re-evaluate if a future feature's complexity genuinely outgrows
vanilla ES modules (Architecture 3.1's own stated revisit clause)

### [EM-002] Schema version compatibility checked by major version only
Version: 1.0
Owner: Backend Lead
Source: PROJECT_LOG.md 2026-07-17 (Milestone 4), docs/ARCHITECTURE.md
Section 16
Approval state: Approved (Milestone 4 Human Approval Brief)
Consumers: core/api.js, any future consumer of analytics.json
Expiry: Permanent

### [EM-003] No default staleness/polling threshold
Version: 1.0
Owner: Backend Lead
Source: PROJECT_LOG.md 2026-07-17 (Milestone 4)
Approval state: Approved (Milestone 4 Human Approval Brief)
Consumers: core/errors.js, core/api.js
Expiry: Re-evaluate once analytics_builder.py's cron-schedule gap
(Current Risks, 2.10) is closed
```

**Nothing enters until approved.** For entries whose expiry condition
constrains a *future major architectural decision*, this is already
covered by existing governance (`DEVELOPMENT_PROCESS.md` §5: "any major
architectural change with no precedent" requires Human approval) — Part
11 does not add a new approval gate, it gives the existing one a place to
record its own outcome.

## 12. Version 2.0 Migration Plan

Nothing below interrupts ongoing implementation. No recommendation
requires rewriting any existing Feature 007 file.

**Immediate** (no new tooling, no approval beyond this document's own,
applies starting the next milestone):
- Targeted, findings-anchored re-verification discipline (Part 8).
- Test Engineer pre-screening before dispatch (Part 1).
- Mandatory Context Justification in dispatch prompts (Part 3).
- Writing the Current Milestone Brief (2.5) as its own short artifact
  instead of composing it fresh inside every prompt.
- Writing the Dependency Graph (2.6) as a standing file.

**Short-term** (a new file, populated once, light review before being
relied upon; no process or governance change):
- Known Decisions, Known Limitations, Review History indices (2.7–2.9) —
  backfilled from Feature 007's real history using the Efficiency
  Report's already-extracted data.
- Engineering Dashboard (Part 10) — as designed above.
- Coding Standards (2.3) — extracted from conventions already established
  and repeatedly restated.
- Technical Secretary as a delegatable role (Part 6) — requires
  `ENGINEERING_ORGANISATION.md` to be updated to define it, which needs
  Human approval of *this document*, but no separate agent-definition
  approval cycle, since it is not a new tool-enforced agent.

**Medium-term** (needs real validation before being trusted as load-bearing):
- Architecture Digest and Design System Digest (2.1, 2.2) — piloted on
  one milestone's review dispatch first, given staleness is this whole
  proposal's largest identified risk (Part 13). Explicit pass/fail
  criterion, in the same style as Part 8's own test: run the dispatch
  once from the digest, then independently re-run the same review from
  the full document; the pilot passes only if the full-document pass
  finds zero additional findings the digest-based pass missed. Any
  miss fails the pilot and blocks general reliance until the digest
  generation method itself is revised and re-piloted.
- API Contracts (2.4) — built incrementally as modules ship; cannot be
  retrofitted with full confidence instantly.
- Engineering Memory promotion (Part 11) — needs the "used 3+ times"
  criterion to actually be exercised before the process is proven.
- A third concurrent parallel stream (Part 9) — only after two-stream
  parallelism succeeds at least once more beyond the single case to date.

**Long-term** (genuinely uncertain, needs capability this session does
not have):
- Any CI-style automatic enforcement that API Contracts (2.4) stay in
  sync with real exports, or that the Architecture/Design System Digests
  (2.1, 2.2) actually get regenerated when their source changes — this
  project has no CI for either; only discipline is available, and the
  digest gap specifically is the concrete mechanism behind Part 13's
  "digest staleness" risk.
- A dedicated frontend (CSS/JS) code-reviewer agent, distinct from Code
  Reviewer's nominal Python scope — real governance work, lowest priority
  given Code Reviewer already performs well outside that nominal scope.
- Revisiting the literal multi-stage Review Pipeline (Part 7) — only if
  the combined-pass approach is later shown, with evidence, to actually
  hit a real ceiling; no such evidence exists today.

## 13. Expected Benefits

All figures below are estimates unless marked otherwise; several are
restated from the Efficiency Report with an independently-reasoned
(slightly more conservative) rationale rather than copied verbatim.

| Metric | Estimate | Confidence |
|---|---|---|
| EM workload reduction (administrative offload) | 20–35% of administrative output volume | Low — no measured baseline exists |
| Code Reviewer token reduction (targeted re-review) | 15–25% of Code Reviewer's aggregate spend | Medium — directly evidenced by the two inverted Round 1/2 pairs |
| Total Feature 007 token reduction | 10–20% of measured subagent spend | Medium — a narrower restatement of the Efficiency Report's own estimate |
| Repeated-context reduction (digests) | Meaningful if adopted, unproven | Low-Medium — largest potential saving, largest quality risk |
| Duplicated-work reduction (log staging) | Eliminates a fully avoidable mechanical cost | High — zero quality trade-off, directly evidenced need |
| Throughput improvement (parallel streams) | 25–40% wall-clock reduction per genuinely independent pair | Medium for the one proven pair; speculative beyond it |
| Coordination improvement | Qualitative — Dashboard + Dependency Graph directly address a real, evidenced pain point (the log-split maneuver) | Medium |
| Review quality | Unchanged, plausibly improved (more reviewer attention on what actually changed, not less scrutiny) | Medium |
| Implementation quality | Unchanged — nothing here touches how code is written | High |

**Largest risk: digest staleness.** If an Architecture or Design System
Digest is not regenerated when its source changes, a reviewer working from
it could miss something a full read would have caught — this is the one
failure mode in this entire proposal capable of silently reducing review
quality, which the brief required to remain unchanged or improve.
**Mitigation:** mechanical, source-derived generation only (2.1, 2.2 — never
hand-summarised), plus the Medium-term pilot-before-reliance gate in Part
12, plus retaining full escalation rights (Part 3) whenever a digest does
not answer the actual question at hand.

**Confidence summary.** High confidence: the mechanical/bookkeeping fixes
(log staging, Dashboard, Test Engineer pre-screening, targeted re-review).
Medium confidence: the digest/context-reduction artifacts — real,
plausible, unproven at scale. Low-to-medium confidence: extending beyond
two parallel streams, and any future revisit of formal pipeline staging —
both explicitly flagged as speculative and deferred to the Long-term tier.
