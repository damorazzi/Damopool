# Damopool Development Process v2.0 ("Engineering Process 2.0")

## 1. Purpose

This document defines the official Damopool Development Process. It is the canonical, operational
engineering standard for every future Damopool milestone, effective 2026-07-23.

Version 2.0 replaces v1.2 in full. It was produced as a formal post-phase engineering review of Phase E
(Milestones 16-31) and the Milestone 5-7 governance correction that preceded it, carried out at Human
request after Phase E's completion and before Phase F begins. Every stage, gate, checklist, and principle
below is grounded in that review's evidence, not written from a template. The full historical review,
the reasoning behind every merge/insertion/addition made to reach this version, and the disposition of
the previously-drafted `docs/ENGINEERING_ORGANISATION_V2.md` proposal are recorded in
`docs/PHASE_E_POSTMORTEM.md` and are not repeated here -- this document states the standard only, to
keep it short enough to reread in full before every major phase.

Prior version history: v1.0 established the original Lead Engineer workflow (Features 002-006). v1.1
replaced the single Lead Engineer model with the named engineering organisation now defined in
`ENGINEERING_ORGANISATION.md`. v1.2 added the Scope Assessment and Waiver requirement after an
Engineering Manager governance audit found Test Engineer had gone silently undispatched across Feature
007's Milestones 5-7. v2.0 supersedes v1.2 after Phase E's evidence showed that rule alone did not
reliably prevent its own recurrence (Milestone 30) -- see `docs/PHASE_E_POSTMORTEM.md` Sections 0, 9, and
12 for the full account.

## 2. Workflow Stages

18 stages. Stages 09 and 17 are conditional; all others apply to every milestone without exception. Any
stage may emit a Stop per Section 7; work then returns to the stage Section 7 names for that condition,
not to the stage where the Stop occurred.

| # | Stage | Purpose | Role | Human Approval? | Impl. Permitted? | Exit Criteria | Required Docs |
|---|---|---|---|---|---|---|---|
| 01 | Feature / Milestone Proposal | State scope against `ROADMAP.md` / `CLAUDE.md` and any recorded precedent | Engineering Manager or Human | Only if scope has no precedent | No | Scope unambiguous enough to investigate | Folded into Stage 3 |
| 02 | Investigation | Verify any empirical claim the design depends on, against real data, before proposing a mechanism | Architecture Lead / Data Pipeline Engineer | No | No | Mandatory when the design depends on an empirical claim about real data; skip for a mechanical, precedented change | Folded into Stage 3 |
| 03 | Design Proposal (architecture + technical design, one document) | Propose mechanism, schema impact, module boundaries before any code | Architecture Lead | Yes -- for any new public contract, new module boundary, or no-precedent decision | No | Recorded "Design Completed" in PROJECT_LOG.md | PROJECT_LOG.md entry; ARCHITECTURE.md schema note if additive |
| 04 | Human Approval -- Design | The Human decides on anything with no precedent, before code exists | Human | This is the gate | No, until approved | Explicit approval recorded | Decision appended to Stage 3 entry |
| 05 | Implementation | Build exactly the approved design | Backend / Frontend / Data Pipeline Lead | No, within approved scope | Yes | Code matches design; shipped files untouched except verified regression (checked via `git diff`) | None yet |
| 06 | Pre-Completion Self-Audit | Force the review-omission question before a milestone can be called complete | Engineering Manager | No -- but its result is a mandatory field in Stage 13 | N/A | Every checklist line (Section 8, Milestone Closure) answered before Stage 7 | Result recorded in PROJECT_LOG.md |
| 07 | Backend Testing | Independent adversarial testing of Python/backend code, per the Independent Review standard (Section 4) | Test Engineer (agent) | No | Test files only | Dispatched for every backend Python change -- no waiver applies to backend Python | Findings summarized in PROJECT_LOG.md, classified per Section 5 |
| 08 | Frontend Testing & Browser Verification | Prove the change works in a real browser | Frontend Lead | No | Test files only | Zero console/page errors; desktop + 375px viewport both pass | Verification summary in PROJECT_LOG.md |
| 09 | Integration / Multi-Scope Testing | Confirm cross-boundary correctness (schema reach, scope isolation) | Test Engineer / EM | No | Test files only | Conditional -- required only when a shared contract changes; otherwise folded into Stage 7/8 | Folded into Stage 7/8 entry |
| 10 | Independent Code Review (+ Targeted Re-Review) | Independent, read-only review of correctness, architecture, validation, CLAUDE.md compliance, per Section 4 | Code Reviewer (agent) | No | None -- read-only | Round 1: full review. Round 2+: dispatch carries the specific findings list plus a diff, not a re-review instruction; widens only for a documented shared interface, a security boundary, or context the diff can't answer alone | Findings + round number in PROJECT_LOG.md, classified per Section 5 |
| 11 | Fix + Re-Verify | Resolve every Blocking/Major finding (Section 5) and independently confirm each fix | Owning Lead | Only if a fix requires touching an already-shipped file for a non-regression reason | Yes | Every Blocking/Major resolved and re-verified; Minor findings fixed if cheap, else carried forward | Fix-by-fix record in PROJECT_LOG.md |
| 12 | Documentation Sync | Check ARCHITECTURE.md / DESIGN_SYSTEM.md and every cross-reference to the changed area | Documentation Engineer | No | Documentation files only | Zero known stale cross-references at commit time | Itself |
| 13 | Human Approval Brief | Present the finished, reviewed, documented milestone for sign-off | Engineering Manager | N/A -- produces the request | No | Brief delivered per Section 2a | The Brief |
| 14 | Human Final Approval | The one non-delegable decision that unlocks commit | Human | Yes -- this is the gate | No | Explicit approval | Recorded in PROJECT_LOG.md |
| 15 | Commit | Stage exactly the approved file set | Release Manager | Yes, separate and explicit | No content changes | Commit created | Commit hash in PROJECT_LOG.md |
| 16 | Push | Publish to the remote | Release Manager | Yes, separate from Commit | No | Push completed, verified against origin | Confirmed in PROJECT_LOG.md |
| 17 | Infrastructure Change Protocol | One named procedure for any change to a live, unversioned, root-owned system | Human executes; EM proposes/verifies | Yes -- every privileged command, one at a time | Human only, from an EM-prepared diff | Endpoint/behavior proof the running system reflects the change | Backup path, checksums, rollback command in PROJECT_LOG.md |
| 18 | Production Verification & Milestone Closure | Confirm live behavior; close the record | EM proposes; Human marks ROADMAP.md | Yes, for the ROADMAP.md status change | No | Live behavior confirmed; log and roadmap updated in the same action | Itself |

### 2a. Human Approval Brief -- Required Fields

Every Stage 13 Brief includes: Feature/Milestone Summary; Files Changed; Tests Created; Tests Executed;
Test Results; Scope Assessments and Waivers (any control that did not apply per its written charter --
never left implicit by omission; where a Waiver applies, its recommendation line reads "N/A -- waived"
and points to the recorded Scope Assessment); the Stage 6 Pre-Completion Self-Audit result; findings by
severity (Section 5) from each review round; Test Engineer Recommendation; Code Reviewer Recommendation;
Remaining Known Limitations; Documentation Updated; Git Status. The Brief itself, and each subagent
report within it, closes with exactly one of: **APPROVE**, **APPROVE WITH KNOWN LIMITATIONS**, or
**DO NOT APPROVE**.

## 3. Roles & Responsibilities

Team roles are fully defined in `ENGINEERING_ORGANISATION.md`, the authoritative Damopool engineering
organisation handbook. This document does not redefine roles, authority, or file boundaries -- it states
only how each role participates in the stages above.

| Role | Participates In | Notes |
|---|---|---|
| **Human (Damien)** | Stages 4, 14, 15, 16, 17, 18; every item in Section 6 (Approval Gates) and Section 7 (Stop Conditions) marked Human-required | Final authority; see Permanent Human Governance below |
| **Engineering Manager** | Coordinates all stages; directly performs any role not delegated elsewhere | Owns Stage 6 and Stage 12 as non-skippable duties |
| **Code Reviewer** (agent) | Stage 10 | Read-only. Scope: Python, plus Damopool frontend HTML/CSS/JS under the standing Phase E waiver (`ENGINEERING_ORGANISATION.md` Section 12) |
| **Test Engineer** (agent) | Stages 7, 9 | Backend Python/sharelog only; no scope change from prior versions |
| **Architecture Lead** | Stages 2, 3 | Delegatable, performed by EM |
| **Backend Lead / Frontend Lead / Data Pipeline Engineer** | Stage 5, and Stage 8 for Frontend Lead | Delegatable, performed by EM |
| **Documentation Engineer** | Stage 12 | Delegatable, performed by EM |
| **Release Manager** | Stages 15-17's mechanical execution | Delegatable, performed by EM; zero independent authority over what is committed, pushed, or deployed |
| **Technical Secretary** | Not created | Considered and deferred -- see `docs/PHASE_E_POSTMORTEM.md` Section 13 |

**Permanent Human Governance** is unchanged from `ENGINEERING_ORGANISATION.md` Section 16: committing,
pushing, marking a feature Completed in `ROADMAP.md`, modifying `CLAUDE.md`/this document/
`ENGINEERING_ORGANISATION.md`/any agent definition, deleting project files, changing previously-shipped
feature code except for a verified regression, any no-precedent public interface or architectural
change, and any no-precedent scope/sequencing decision all remain under explicit Human control at all
times, regardless of how much of a milestone proceeds without per-step approval.

**Approval Memory**, also unchanged in substance: a design decision recorded as "Design Completed" in
`PROJECT_LOG.md` is settled and is not re-argued during implementation or later review -- subsequent
reviews are asked only to verify the code correctly implements it. Lessons from one milestone's findings
are applied proactively in later milestones without waiting to be told again (the standalone-module
pattern established at M28 and reused without prompting at M29-M31 is the model).

## 4. Independent Review Definition

**Formal definition:** Independent review means verifying or re-deriving a claim from the underlying
evidence directly -- not reading the implementation's own explanation of why it is correct and
confirming that the explanation is internally consistent. A review that only checks "does the code do
what its comment says" has not independently reviewed anything; it has proofread a claim.

**The standard, by claim type:**

| Claim type | What independent review requires |
|---|---|
| A claim about data (e.g. "this value never repeats," "this file is untouched," "this test isolates state X") | Re-derive the claim against the actual underlying evidence -- real records, a real `git diff`, a real file's checksum or mtime -- rather than trusting the implementation's own comment or docstring asserting it |
| A claim that a fix resolves a finding | Trace the specific code path the finding named and confirm the mechanism directly; where feasible, reproduce the originally-reported failure against the pre-fix code so the fix is shown to address the actual mechanism, not just the symptom |
| A design recommendation | Form and disclose an independent position rather than defaulting to whatever the implementation already chose |

This applies to every dispatch of Code Reviewer (Stage 10) and Test Engineer (Stage 7), and to the EM's
own Stage 6 self-audit.

## 5. Severity Classification

The canonical severity vocabulary for Code Reviewer, Test Engineer, and the Stage 6 self-audit.

| Level | Definition | Mandatory Action | Approval Impact | Implementation May Continue? | Human Approval Required? |
|---|---|---|---|---|---|
| **Blocking** | A defect that would cause incorrect data, a crash, a security exposure, a violation of a `CLAUDE.md` safety rule, or a violation of an already-approved design decision, if left in place | Fixed and independently re-verified before the milestone advances past Stage 11 | No Human Approval Brief may be produced while a Blocking finding is open | No, on the affected file, until fixed and re-verified | No approval needed to perform the fix itself; the milestone simply cannot advance without it |
| **Major** | A real, reproducible defect that doesn't meet the Blocking bar but is a genuine, user-visible or compounding gap in correctness, accessibility, architecture fidelity, or documentation accuracy | Resolved before the Human Approval Brief, or explicitly carried forward with a stated reason | Every Major finding appears, resolved-or-carried-forward, in the Brief | Yes, on unrelated work; the specific file should not reach commit unresolved | Yes -- a Major finding may only be left open by an explicit Human decision to carry it forward |
| **Minor** | A real but low-impact defect, code-quality note, or already-disclosed limitation that doesn't affect the milestone's core correctness claim | Fixed immediately if cheap and unambiguous; otherwise recorded as a known limitation | Listed in the Brief's Known Limitations; does not block approval | Yes, unconditionally | No |
| **Observation** | Not a defect -- a process note, a named design tension, a tracked risk, or a positive confirmation ("verified correct, no action needed") | None required; recorded for context | Does not appear as a "finding" line; may be quoted in the Brief's narrative | Yes, always | No -- an Observation that surfaces a genuine architectural fork escalates via Stage 4 (Design) or the Disagreement Arbitration gate (Section 6) instead |

Severity reflects the defect, not how hard it is to resolve. A finding is never downgraded because the
fix looks obvious.

## 6. Approval Gates

| Gate | Triggers On | Evidence Required |
|---|---|---|
| Design approval (Stage 4) | Any new public data contract, new module boundary, or no-precedent decision | A Stage 3 proposal naming the mechanism, schema impact, and every open question |
| Waiver approval | Omitting or using Test Engineer / Code Reviewer outside its written charter | A recorded Scope Assessment stating exactly which control cannot apply and why; a prior, unrelated approval never substitutes; citing a standing waiver requires quoting its exact recorded text |
| Disagreement arbitration | Test Engineer and Code Reviewer reach opposite conclusions on the same question | Both positions stated plainly, with any EM first-attempt disclosed; the Human decides, not the EM by tie-break |
| Human Approval Brief (Stage 13 -> 14) | Every milestone, before commit | Full Section 2a field set |
| Commit | Every commit | An explicit instruction naming this specific action |
| Push | Every push | A separate explicit instruction, even immediately after a Commit approval |
| Infrastructure change (Stage 17) | Any privileged command against a live, unversioned, root-owned system | A pre-diffed proposed change, a named rollback command, confirmation no subagent charter covers this file type |
| Editing an already-shipped file for a non-regression reason | Refactor, extraction, or cleanup of previously-approved code with no verified regression behind it | The specific issue named, weighed explicitly against the blast-radius cost of touching shipped code |
| ROADMAP.md status change | Marking any feature Completed | Never made while a relevant review is still open |

## 7. Implementation Stop Conditions

Routine gates (Section 6) are decision points reached in the normal stage order. Stop Conditions are
exception paths triggered out of order, at any stage, by new evidence. A Stop pauses only the affected
stage's work -- unrelated milestones already in flight are unaffected.

| # | Condition | Who May Trigger | Required Documentation | How Work Resumes | Human Approval to Continue? |
|---|---|---|---|---|---|
| 1 | Investigation disproves the proposed mechanism | Architecture Lead during Stage 2/3; any Lead or subagent who finds it later | The specific disproof and evidence | A new mechanism proposal returns to Stage 3 -- never patched onto the disproven one | Yes -- re-enters Stage 4 for the new mechanism |
| 2 | Production data contradicts assumptions | Anyone who observes it directly against real data, not secondhand | The specific contradicting record(s), verified directly | Returns to Stage 2 to re-verify the corrected assumption | Yes, if the correction changes the design; No, if it only changes an implementation detail |
| 3 | Architecture assumptions become invalid | Architecture Lead, or any Lead who discovers the conflict while implementing | Which existing architecture decision is contradicted, and why | Returns to Stage 3/4 as an explicit architecture amendment | Yes -- a Permanent Human Governance item |
| 4 | Schema compatibility breaks | Backend Lead / Data Pipeline Engineer, or Code Reviewer at Stage 10 | The exact incompatibility | Returns to Stage 3 as a new major-version proposal -- never shipped as a minor/patch bump | Yes, always |
| 5 | Blast radius exceeds approved design | Any Lead who finds the change now needs a file, module, or already-shipped feature outside the Stage 3 proposal's stated scope | The specific newly-implicated file(s) and why | Presented as an explicit scope-expansion request before implementing it | Yes, for the expanded scope specifically |
| 6 | A Blocking review finding is discovered | Code Reviewer, Test Engineer, or the EM's own Stage 6 self-audit | The finding itself, filed at Blocking severity (Section 5) | Fixed and independently re-verified (Stage 11) before Stage 12 begins | No additional approval to perform the fix; the milestone cannot advance without it |
| 7 | A previously unknown dependency appears | Anyone who discovers a dependency not named in the Stage 3 proposal | What the dependency is and what about it is unverified | A targeted Stage 2 investigation of that dependency specifically | Yes, if it touches a protected file, infrastructure, or an already-shipped feature; No, if fully within the current Lead's own boundary |
| 8 | Implementation would require modifying already-approved architecture | Any Lead | Which decision would need to change, and what alternative was originally rejected, if recorded | Returns to Stage 3/4 as a formal architecture amendment | Yes, always -- a Permanent Human Governance item |

## 8. Mandatory Checklists

### Implementation

- New capability lives in its own standalone module, not woven into an existing incremental engine,
  unless explicitly justified otherwise. (Always)
- Schema changes are additive only; version bump recorded. (Every schema-touching milestone)
- No already-shipped file touched without a verified regression or explicit approval, checked via
  `git diff`, not assumed. (Always)
- Every numeric/derived field has an explicit non-finite / divide-by-zero guard where inputs can be
  missing or extreme. (Every milestone computing a derived numeric field)
- Parallel code paths performing the same risky operation (e.g. two file reads) have identical
  defensive handling. (Always)
- Already-tested validation and math primitives are reused rather than reimplemented across milestones.
  (Always)

### Testing

- Full suite green before and after every fix round. (Always)
- New test files isolate any new state-path parameter -- grep every existing caller of the changed
  function, not just files touched this milestone. (Every milestone adding a state-path parameter)
- Every sibling field feeding the same downstream function is validated the same way as the field that
  prompted the fix. (Every validation-gap fix)
- Protected production files (`pool_stats.json`, `historical_data.json`, `parse_pool_stats.py`,
  `ckpool.conf`) confirmed untouched -- by checksum if the file lives outside this git repository.
  (Always)
- Real-browser verification run at a desktop and a 375px viewport, zero console/page errors. (Every
  frontend-touching milestone)
- Where a retired component is replaced, its full prior feature set is explicitly checklisted against
  the replacement. (Every retirement/replacement milestone)

### Documentation

- `docs/ARCHITECTURE.md` and `docs/DESIGN_SYSTEM.md` grepped for every reference to the changed
  module/schema/component. (Always)
- Every stale cross-reference found is fixed in the same milestone, not deferred. (Always)
- `PROJECT_LOG.md` entry includes brief, investigation (if any), design decision, findings by round,
  fixes, carried-forward limitations. (Always)
- Any Human decision overturning a prior recorded decision states the reversal explicitly. (Every
  reversal)

### Review

- Scope Assessment recorded for both Test Engineer and Code Reviewer before either is invoked or
  waived. (Always)
- Any waiver cited quotes its recorded text verbatim, with a pointer to where it lives. (Every waiver
  citation)
- Round 2+ review dispatches carry the specific findings list plus a diff, not a re-review instruction.
  (Every re-review)
- Every finding is classified per Section 5 and, where Blocking or Major, independently re-verified per
  the Section 4 standard. (Always)
- Minor findings are fixed immediately or explicitly carried forward -- never silently dropped. (Always)

### Deployment

- Commit approval and push approval requested and recorded separately. (Always)
- Backup taken and checksum-verified before the edit. (Every infrastructure change)
- Syntax/dry-run test passed before any reload/apply. (Every infrastructure change)
- Post-change verification checks the running state (loaded config, active service), not just the file
  on disk. (Every infrastructure change)
- A named, tested rollback command exists and is recorded, whether or not needed. (Every infrastructure
  change)

### Milestone Closure

- Stage 6 self-audit result present in the Human Approval Brief. (Always)
- Live/production behavior independently confirmed, not assumed from a successful commit. (Always)
- `PROJECT_LOG.md` and `ROADMAP.md` updated in the same approved action. (Always)
- Any open, disclosed limitation is recorded as carried-forward with enough context to avoid
  rediscovery. (Always)

## 9. Engineering Flow Diagram

`◆` = mandatory Human approval gate. `▸` = conditional stage.

```
 01 Feature / Milestone Proposal
      |
 02 Investigation                          ▸ mandatory only if an empirical claim is load-bearing
      |
 03 Design Proposal (architecture + technical design, one document)
      |
 ◆ 04 HUMAN APPROVAL — Design
      |
 05 Implementation
      |
 06 Pre-Completion Self-Audit               (result mandatory in Stage 13)
      |
      +----------------------+
      |                       |
 07 Backend Testing      08 Frontend Testing + Browser Verification
      |                       |
      +-----------+-----------+
                  |
 09 Integration / Multi-Scope Testing       ▸ conditional: shared-contract changes only
                  |
 10 Independent Code Review  (round 2+: targeted re-review against a diff, not a re-read)
                  |
 11 Fix + Re-Verify   <-- loops back to 10 if a fresh review pass is warranted
                  |
 12 Documentation Sync
                  |
 13 Human Approval Brief
                  |
 ◆ 14 HUMAN FINAL APPROVAL
                  |
 ◆ 15 COMMIT
                  |
 ◆ 16 PUSH
                  |
 17 Infrastructure Change Protocol           ▸ conditional: Nginx / cron / systemd only
      (each privileged step is its own ◆)
                  |
 18 Production Verification & Milestone Closure
      (PROJECT_LOG.md + ◆ ROADMAP.md status, same approved action)
```

Any stage may emit a Stop per Section 7; work returns to the stage Section 7 names for that condition,
not to the stage where the stop occurred.

## 10. Engineering Principles

| Principle | Rule |
|---|---|
| Additive-first | Every schema change adds; none remove or reshape |
| Smallest blast radius | New capability gets a standalone module; a duplicated helper is preferred over an unapproved edit to a shipped file |
| Investigation before mechanism | When a design depends on an empirical claim, verify it against real data before proposing the mechanism, and state plainly what remains unproven |
| Evidence over assumption | "It hasn't broken" is not the same claim as "it's verified" |
| Waivers are literal | A waiver's recorded text is quoted exactly, every time; it never auto-extends to a new phase, file type, or neighboring case |
| Documentation sync is Definition of Done | Not a thing a reviewer happens to catch -- see Stage 12 |
| No silent self-declared completion | A milestone is done when the Stage 6 checklist says so in writing, before the Human is asked to approve anything |
| Every fix earns a regression test | Aimed at the exact defect found, not a general strengthening |
| Independent verification means re-deriving, not re-reading | Per Section 4 -- targeted re-review checks the claimed fix against the specific finding and the diff |
| Severity reflects the defect, not the effort to fix it | Per Section 5 -- a finding is never downgraded because a fix looks easy |
| Reuse over reimplementation | Already-tested validation and math primitives are reused across milestones rather than duplicated |
| Production is never the test bed | Read-only against real logs where evidence requires it; writes only to isolated, gitignored, or explicitly-scoped paths; every new state-path parameter is checked against every existing test caller. Production data and already-shipped output formats (`pool_stats.json`, `historical_data.json`, `parse_pool_stats.py`) are never touched by this workflow |
| Precision matches what was measured | A reported figure is only as precise as what was actually measured; where something cannot be measured, that limitation is stated rather than a number invented |

**Progress reporting**, carried forward unchanged: the Human is told, briefly, when a subagent is
launched and what it is doing, before its result is known. Subagent findings are never predicted,
assumed, or fabricated ahead of the actual result. Findings are reported with their severity
classification intact, not summarized away. State changes that would be hard to reverse, or that assert
a milestone is further along than independently confirmed, are not made while a relevant review is still
in progress.

For the full historical review and rationale behind this document, see `docs/PHASE_E_POSTMORTEM.md`.
