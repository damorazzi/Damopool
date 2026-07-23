# Phase E Postmortem

**Status:** Adopted 2026-07-23, alongside `DEVELOPMENT_PROCESS.md` v2.0 ("Engineering Process 2.0"),
which this document supplies the rationale for. This document is historical review and rationale
only — it is not itself a workflow specification. For the canonical, operational standard, see
`DEVELOPMENT_PROCESS.md`.

**Covers:** Milestones 16-31, plus the Milestone 5-7 governance correction that preceded and shaped
them. Sources read in full or in relevant part: `CLAUDE.md`, `DEVELOPMENT_PROCESS.md` v1.2 (as it
stood before this revision), `ENGINEERING_ORGANISATION.md` v1.0, `docs/ENGINEERING_ORGANISATION_V2.md`
(draft), `docs/ARCHITECTURE.md`, `docs/DESIGN_SYSTEM.md`, `PROJECT_LOG.md`, `ROADMAP.md`,
`.claude/agents/*.md`.

## 0. Executive Summary

Phase E shipped sixteen milestones (16-31) cleanly -- every one independently reviewed or explicitly
waived, every commit and push separately authorized, every schema change additive. That record is
real and is the foundation `DEVELOPMENT_PROCESS.md` v2.0 builds on, not a story it needed to invent.

It also surfaced one structural gap twice. Milestone 30 was presented to the Human as complete --
implementation, self-authored tests, self-run browser verification -- with **no** independent review
dispatched and no waiver recorded. It was caught only because the Human asked directly whether the
correct procedure had been followed, before granting any approval. The written rule already required
otherwise (`DEVELOPMENT_PROCESS.md` v1.2, Section 6 step 5), and had existed since an almost identical
failure on Milestones 5-7 a phase earlier. The rule was not the problem; nothing forced a check of the
rule *before* the milestone was declared done. Milestone 31 corrected this proactively -- the first
real evidence the habit, not just the paper rule, had taken hold. Process 2.0's single most important
change is to make that check structural (its Stage 6: Pre-Completion Self-Audit) rather than dependent
on the Human remembering to ask.

Beyond that, this review is deliberately conservative in what it recommends changing. Damopool's roles,
workflow, and governance gates (`ENGINEERING_ORGANISATION.md` v1.0, `DEVELOPMENT_PROCESS.md` v1.2) are
not shown by Phase E's evidence to be broken -- they are shown to work when actually followed. A draft
Version 2.0 of the organisation document (`docs/ENGINEERING_ORGANISATION_V2.md`) sat unreviewed since
2026-07-18; this postmortem resolves it item-by-item (Section 13) rather than leaving it in permanent
limbo, adopting only what Phase E's own record actually supports.

## 1-10. Phase E Engineering Review

Ten areas, each graded against what the record actually shows -- not what the process documents
claimed. "Overall Lessons" (the review brief's own item 11) is folded into Section 11 (Lessons Learned)
rather than repeated here.

### 1. Architecture

**Strongest practice: standalone-module isolation.** Every new capability since Milestone 28 shipped as
its own independent module -- `ckpool_native_stats.py` (M28), `histogram_builder.py` (M29),
`block_progress.py` (M30), `worker_sessions.py` (M31) -- rather than being woven into
`analytics_state.py`'s incremental engine. This costs a repeated full read of sharelog bytes each
module takes on independently; it buys the fact that M29's three rounds of bugs (Section 5) stayed
contained to one file each time and never touched the incremental engine every other module depends
on. This is Phase E's highest-leverage architectural decision and is now a named principle (Section 10
of `DEVELOPMENT_PROCESS.md`), not an unstated convention.

**Additive-only schema discipline held without exception.** `schema_version` moved
1.1 -> 1.2 -> 1.3 -> 1.4 -> 1.5 across M28-M31; every bump added fields, none removed or reshaped one.

**Design stability under real reversal.** Two Human-directed reversals of already-shipped behaviour
(M25's truncation scope overturned by M26; M27's nav-breakpoint removal) were both handled as explicit,
re-approved amendments with a recorded reason -- not silent drift.

**The frontend architecture proved itself.** Global Live Feed (M27) -- the single largest net-new piece
of frontend surface in Phase E -- required zero changes to the directory structure, router, or state
model `docs/ARCHITECTURE.md` defined in Phase A. That is the document's own stated success criterion,
demonstrated rather than merely claimed.

### 2. Human Approval

Every milestone stopped for an explicit Human Approval Brief before commit, and commit/push were never
bundled -- a discipline held across all sixteen milestones with no exception in the record.

**The approval gate arbitrated a genuine disagreement correctly.** In M30, Code Reviewer and Test
Engineer gave *opposite* recommendations on whether `block_progress`'s two output fields should null
independently or as a coupled pair. Rather than either subagent's view winning by default, the Human
made the actual architectural call -- exactly what a Human approval gate is for, not a rubber stamp on
work already finished.

**What went missing:** the M30 review-omission gap (Section 0) was closed by the Human's own vigilance,
not by the process. A discoverability failure compounds this: M25's own Code Reviewer could not locate
the exact waiver text it had been told to cite, by searching `PROJECT_LOG.md` itself -- the file has
simply grown too long for search to reliably reach a citation from months earlier. Both point the same
direction: approval-relevant facts need to be structurally surfaced, not just truthfully recorded
somewhere in a growing log.

### 3. Investigation

Two milestones model the standard well. M28 (native hashrate) ruled out the obvious existing data
source (`pool_stats.json`) on two independent, verified grounds -- incompleteness and staleness --
before proposing a new module, rather than assuming it would do. M31 (worker sessions) is the sharper
example: its *first* mechanism sketch (track `clientid`) and its *second* refinement were both
individually disproven against real production data before a third, correct signal (`enonce1`) was
found and verified across all 195,725 real records. The investigation did not stop at "a mechanism that
seems to work" -- it kept looking until the claim was checked against every real record available, and
it explicitly disclosed what remained *unproven* (no mathematical guarantee `enonce1` can never repeat
over an arbitrarily long pool lifetime) rather than overstating the result.

**Gap:** the M30 process omission (Section 0) shows investigation discipline was never extended to the
process itself -- nobody's job was to check "has this milestone actually been independently reviewed"
before declaring it done, the same rigor routinely applied to a technical claim.

### 4. Implementation

Blast-radius discipline is real, not aspirational: `describeFetchError` and the pool-emptiness check
remain deliberately duplicated across `overview.js` and `pool.js` rather than extracted, because
extraction would mean editing an already-shipped, already-approved file without a regression to justify
it -- a cost knowingly accepted, tracked, and revisited only with explicit approval, not silently
"cleaned up."

Every fixed defect across Phase E produced a new regression test aimed at that exact defect
(loading-skeleton tile-count parity after M28's Major #1; the exact `DAY_WINDOW` vs. retention-buffer
test after M29's Major; `normalizePath` trailing-slash tests after M27's Minor). This is a real,
consistent practice, now a named principle.

### 5. Testing

Backend tests grew 312 -> 561 across M28-M31 alone; frontend tests reached 893 by M31. Real-browser
(Playwright) verification became a required gate starting M17 and has run on every frontend-touching
milestone since.

**Best example of genuine independent verification in the whole phase:** M31's Test Engineer did not
trust the implementation's own claim that `enonce1` is unique per connection -- it independently
re-derived the claim from scratch against all 195,725 production records and separately confirmed the
specific `clientid=7`-reused-across-three-users case resolves correctly end-to-end.

**The M29 cascade is the phase's clearest testing lesson.** Three independent review rounds each found
a real bug the *previous* round's fix had not fully closed: a reporting-window confusion, then a
shallow validation gap on one field, then the identical gap on a sibling field the first fix hadn't
touched. This is a textbook case for a "check every sibling field feeding the same downstream function"
rule, not a one-off oversight.

**A real production-safety near-miss:** M31's Code Reviewer found, as its own Blocking finding, that two
*earlier* Test-Engineer-authored test files never isolated a newly-added state-path parameter -- every
full test-suite run had been silently writing to the real production `worker_sessions.state.json`. This
was caught by one reviewer's attentiveness, not by any structural safeguard that made the omission
visible on its own.

### 6. Independent Code Review

Consistently high-value: no milestone in the read record returned a clean first pass, and every
Blocking/Major finding traced to a real, reproducible defect. The scope-creep/disclosure gap is real but
benign in practice, and was overdue for paperwork to catch up: Code Reviewer's written charter
(`.claude/agents/code-reviewer.md`) was Python-only; every Phase E frontend milestone dispatched it
anyway, disclosed each time under the Phase E waiver, with an excellent track record but no charter
amendment reflecting it. Closed by this revision (Section 14).

### 7. Independent Test Engineer

Scoped, by its own charter, to backend Python only -- and this scope held without drift, unlike Code
Reviewer's. When dispatched, it caught real Blocking issues (M28's `UnicodeDecodeError` that could abort
an entire analytics run). The largest standing structural gap in the whole project is exactly what the
Milestone 5-7 Governance Correction Proposal named and left open: no independent, adversarial testing
exists for frontend code. The Engineering Manager writes and self-verifies every frontend test. This has
not yet produced a visible incident, but it is the one area where Phase E's good track record is least a
function of independent verification and most a function of the reviewing Code Reviewer instance
catching things on the way past. Not closed by this revision -- no charter change is recommended for
Test Engineer, since no track record exists to justify one; this gap is named here so it isn't
forgotten, not resolved.

### 8. Documentation

A recurring, named category of defect: stale cross-references inside `docs/ARCHITECTURE.md` itself,
caught as a Major finding on at least four separate occasions (M24's Section 3.2, M27's Section 22
wireframes, M28's Section 3.4, M23's prior instance). The same *kind* of defect recurring four times
across four different milestones is not bad luck -- it is evidence that documentation sync was not part
of a milestone's definition of done, only something a reviewer happened to catch afterward. Closed by
Process 2.0's Stage 12.

`PROJECT_LOG.md`'s own scale is now a real liability, not a hypothetical one: over 600 lines,
prepended chronologically with no index, already large enough that a dispatched reviewer failed to find
a citation by searching it (M25). It remains the right source of narrative truth; it is no longer a
practical way to answer "has X already been decided." Not closed by this revision -- a lightweight
Known Decisions/Waivers index is recommended (Section 14) but not yet built.

### 9. Governance

The single most consequential governance event of the project is the **Milestone 7 Governance
Correction** (2026-07-18): a self-detected deviation (Test Engineer silently never dispatched across
Milestones 5-7; Code Reviewer used informally outside its charter with no waiver, no disclosure in the
Human Approval Brief), Feature 007 paused mid-review, a formal three-option proposal produced, and
Option 2 (scope-based dispatch with recorded, Human-approved waivers) adopted. Every waiver-discipline
rule Phase E operated under -- Scope Assessment, explicit Waiver Request, verbatim citation -- is a
direct descendant of that one correction.

Milestone 30 shows the same failure mode recurring in a new shape, seven weeks and sixteen milestones
after the rule was written down. The rule existing on paper did not, by itself, make the habit of
checking it fire reliably before a milestone was declared complete. Milestone 31's proactive, unprompted
correction is the first real evidence the habit had caught up with the rule.

`ENGINEERING_ORGANISATION_V2.md` sat as an unresolved draft for the entirety of Phase E -- drafted
2026-07-18, never approved, never rejected. Real, well-evidenced proposals inside it (targeted
re-review, per-stream log staging) never got tested against the sixteen milestones that could have used
them. An unresolved draft was itself a governance gap; resolved by this revision (Section 13).

### 10. Deployment

Commit/push cadence held perfectly: separate explicit approval for each, every time, across every
milestone read.

Infrastructure changes were the least standardized part of the whole process. Three separate milestones
(M21 Nginx alias, M22 cron scheduling, M24 HTTP/2) each touched a live, unversioned, root-owned system
outside git -- and each time, a bespoke "one-off Infrastructure Scope Assessment" was invented from
scratch: backup, checksum, diff-before-editing, syntax test, graceful reload, independent post-reload
verification, a named rollback command. The ritual had a perfect safety record across all three uses. It
had never been written down as a single, reusable protocol -- each milestone re-derived it. Closed by
Process 2.0's Stage 17.

Rollback readiness for infrastructure changes was genuinely excellent (a named command, a
checksum-verified backup, every time). The equivalent question for a *code*-level regression -- "if this
milestone misbehaves once live, what is the actual revert path" -- was never asked in the record; Phase
E never needed one, which is not the same as having one ready. Not addressed by this revision; flagged
for a future process iteration if a real incident makes it necessary.

## 11. Lessons Learned

| Category | Lesson |
|---|---|
| Engineering | Standalone-module isolation is the reason Phase E's worst bug cascade (M29, three rounds) never spread past one file. Keep paying the "read the bytes twice" cost. |
| Engineering | Cascading validation gaps recur along sibling fields, not just the field named in the bug report -- check every sibling feeding the same downstream function, every time. |
| Architectural | A frontend architecture is only proven durable when a real, large, novel feature (Global Live Feed) ships inside it with zero structural change -- that happened once in Phase E; treat it as the bar for calling any future architecture "extensible," not just an assertion in the design doc. |
| Governance | A written rule does not, by itself, produce the habit of checking it. The same review-omission failure recurred (M5-7, then M30) after the rule existed on paper. Only a structural, checklist-shaped gate closes this reliably. |
| Governance | When two independent reviews genuinely disagree, that is the approval gate working as designed, not a process failure to smooth over -- the Human should be told exactly what each side found, not handed an EM-arbitrated summary. |
| Testing | The single most valuable testing act in Phase E was re-deriving a claim from every real record available, not trusting the implementation's own comment. Independence is a method, not a job title. |
| Documentation | A chronological, prepended, never-indexed log stops being searchable long before it stops being accurate. The content wasn't wrong; a reviewer just couldn't find it. |
| Review | Practice quietly outrunning charter (Code Reviewer's informal frontend scope) is not itself a defect, but leaving the paperwork behind indefinitely is a standing, avoidable governance debt. |

## 12. Why Engineering Process 2.0 Is Structured the Way It Is

`DEVELOPMENT_PROCESS.md` v2.0 compresses a proposed 21-stage workflow to 18. Three merges and three
insertions explain that number, and the reasoning belongs here, not in the standard itself:

**Merges -- because Phase E's own record shows the steps were always delivered as one artifact with one
approval:**
- *Architecture Review + Technical Design* -> one Design Proposal stage. Every Phase E milestone needing
  architectural sign-off (M27, M28, M30, M31) delivered architecture and detailed design as a single
  document with a single Human decision.
- *Human Architecture Approval + Human Design Approval* -> one Human Approval: Design gate, for the same
  reason.
- *Production Verification + Project Log Update + Milestone Closure* -> one closing stage. Every
  milestone in the record closed these together, inside the same commit and the same Human Approval
  Brief.

**Insertions -- each closing a gap named above:**
- **Pre-Completion Self-Audit** -- closes the Milestone 30 gap (Sections 2, 9).
- **Documentation Sync** -- closes the four-times-recurring stale-cross-reference gap (Section 8).
- **Infrastructure Change Protocol** -- names the ritual already proven three times but never written
  down (Section 10).

Three further additions were made after a Human architectural review of the first draft:

- **Severity Classification** -- the original draft used Blocking/Major/Minor informally, inherited from
  the existing agent charters, without ever defining what each level obligates. Formalized, with a
  fourth level, Observation, added for process notes and positive confirmations that are not themselves
  defects (e.g. M30's Test Engineer flagging a mid-session coordination risk that was not itself a
  finding).
- **Implementation Stop Conditions** -- the original draft had no explicit answer for what happens when
  new evidence appears mid-implementation (an investigation is disproven, a dependency turns out to be
  undocumented, blast radius grows past the approved design). Eight named conditions now cover this,
  each with who may trigger it, what must be documented, how work resumes, and whether Human approval is
  needed to continue.
- **Independent Review Definition** -- "independent" was used throughout the original draft without a
  formal definition. Now defined explicitly: independent review means re-deriving or verifying a claim
  against the underlying evidence, not confirming that the implementation's own explanation is internally
  consistent. Grounded in M31 (re-deriving the `enonce1`-uniqueness claim from all 195,725 real records)
  and M30 (Code Reviewer and Test Engineer reaching genuinely opposite recommendations, evidence neither
  was deferring to the other or to the implementation).

A consistency pass across the whole revised document, performed before final adoption, found and closed
the following:

1. **Section numbering drift** from inserting three new sections -- renumbered throughout, with every
   internal cross-reference (e.g. Stage 6's pointer to the Milestone Closure checklist) updated to match.
2. **A fourth severity tier without a matching agent-charter update** -- `.claude/agents/code-reviewer.md`
   and `.claude/agents/test-engineer.md` both instructed exactly three severities in their required
   output format. Closed by this revision (Section 14) rather than left as a standing mismatch between
   the process document and the tool-enforced agents that implement it.
3. **Apparent overlap between Approval Gates and Stop Conditions** -- clarified as complementary, not
   duplicative: gates are routine, expected decision points; Stop Conditions are exception paths
   triggered out of order by new evidence.
4. **Checklist redundancy** -- a Review-checklist line partially restated the new Independent Review
   Definition and Severity Classification sections; trimmed to a cross-reference.
5. **"Milestone" vs. "feature" terminology** -- confirmed deliberate: Phase E actually operated
   milestone-by-milestone, not feature-by-feature, so Process 2.0 matches how the work was actually done,
   not how the superseded v1.2 framed it.
6. **Human-governance wording** -- cross-checked word-for-word against `ENGINEERING_ORGANISATION.md`
   Section 16's Permanent Human Governance list; confirmed matching, not assumed.
7. **The flow diagram does not show Stop Condition branch points** -- left as a clean linear diagram,
   with a note that any stage may emit a Stop per the relevant section, rather than cluttering it with a
   branch at every node.

## 13. Disposition of the ENGINEERING_ORGANISATION_V2.0 Draft

Every proposal in the draft, resolved on its own evidence rather than left open. The resulting decisions
are what `DEVELOPMENT_PROCESS.md` v2.0 actually adopts; the reasoning lives here.

| Draft item | Disposition | Why |
|---|---|---|
| Targeted, findings-anchored re-review (Part 8) | **Adopted** | Directly evidenced: two paired review rounds cost *more* the second time, which is the exact inversion this fixes, with no quality downside. |
| Per-stream log staging (Part 9) | **Adopted** | Zero quality trade-off, directly evidenced need (a manual log split-and-restore was required once already). |
| Test Engineer pre-screening before dispatch | **Adopted** | Already effectively true in Phase E (Test Engineer's scope discipline held); formalizes the habit, not a new mechanism. |
| Mandatory Context Justification (Part 3) | **Adopted** | Formalizes an already-mostly-good practice; costs nothing to state explicitly. |
| Architecture / Design System Digests (Parts 2.1-2.2) | **Pilot only** | Largest potential saving *and* largest real risk (staleness silently hiding a finding). Per the draft's own stated gate: pilot on one milestone, and it passes only if a full-document re-review finds zero additional findings the digest-based pass missed. Not yet piloted. |
| Technical Secretary role | **Deferred** | No track record exists. Nothing in Phase E's record shows administrative drafting load was the binding constraint on any milestone; revisit if it becomes one. |
| Engineering Dashboard (Part 10) | **Deferred** | Real value, but is a rollup of facts that must already exist elsewhere -- build it once a Known Decisions/Waivers index exists to roll up from, not before. |
| Versioned Engineering Memory (Part 11) | **Deferred** | Formalizes a real concept (`DEVELOPMENT_PROCESS.md`'s existing Approval Memory principle) but adds a second formal promotion process before a simpler index has even been tried. |
| Third+ concurrent parallel stream | **Rejected for now** | The draft's own position: no evidence exists for more than the one tested two-stream pair; Phase E ran zero parallel streams at all. Nothing to revisit until two-stream parallelism is used again. |
| Literal multi-stage review pipeline (architecture / correctness / security / performance as separate dispatches) | **Rejected** | Direct evidence against it: Phase E's combined single-dispatch Code Review pass already covers every one of those dimensions in one pass with a strong track record; splitting them risks a finding falling between stages with no compensating benefit shown. |

`docs/ENGINEERING_ORGANISATION_V2.md` itself is retained as a historical record of this analysis, with
its draft status marked resolved rather than the file being deleted or rewritten.

## 14. Documentation Updates Made With This Adoption

| Document | Why it needed changing | What changed |
|---|---|---|
| `DEVELOPMENT_PROCESS.md` | v1.2's Scope Assessment rule existed but did not, by itself, prevent Milestone 30's recurrence of the exact failure it was written to close. | Replaced in full with Engineering Process 2.0 (v2.0): the 18-stage workflow, Independent Review Definition, Severity Classification, Approval Gates, Implementation Stop Conditions, Mandatory Checklists, Flow Diagram, and Engineering Principles. |
| `ENGINEERING_ORGANISATION.md` | Code Reviewer's written charter had lagged its actual, well-evidenced practice for the entire project. | Section 12 amended to state its scope explicitly includes Damopool frontend HTML/CSS/JS under the standing Phase E waiver -- codifying, not expanding, current practice. |
| `docs/ENGINEERING_ORGANISATION_V2.md` | Sat as an unresolved DRAFT through all of Phase E -- itself a governance gap. | Status header updated to record its resolution per Section 13 above; substantive content untouched, retained as historical record. |
| `.claude/agents/code-reviewer.md` | Scope was Python-only in writing despite an established frontend practice; severity vocabulary lacked the new Observation tier. | Added one sentence extending written scope to Damopool frontend HTML/CSS/JS under the Human-approved Phase E waiver; added Observation as an optional fourth finding category. |
| `.claude/agents/test-engineer.md` | Severity vocabulary lacked the new Observation tier. | Added Observation as an optional fourth finding category. No scope change -- remains backend Python/sharelog only. |
| `PROJECT_LOG.md` | Every milestone and governance decision in this project is recorded here. | New entry added recording this adoption. |

**Not yet done, explicitly tracked rather than silently skipped:** a lightweight, append-only Known
Decisions/Waivers index as a separate file (an index into `PROJECT_LOG.md`, never a replacement for it);
a one-time documentation-sync pass confirming `docs/ARCHITECTURE.md` and `docs/DESIGN_SYSTEM.md` are
currently fully in sync (Process 2.0's Stage 12 will catch drift going forward, but no retroactive pass
has been performed); a pilot of the Architecture/Design System Digests concept.
