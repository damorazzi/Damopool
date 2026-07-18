# Damopool Development Process v1.2

## 1. Purpose

This document defines the official Damopool Development Process. It is
based on the engineering workflow successfully validated during the
implementation of Features 002 (Pool Statistics), 003 (User Statistics),
004 (Worker Statistics), 005 (analytics.json), and 006 (Website
Integration). Future feature development should follow this process
unless it is formally revised. It exists to provide a consistent,
repeatable engineering process and to ensure anyone reviewing the project
understands how software is designed, implemented, tested, reviewed,
approved, and released.

Version 1.1 records one change: the single "Lead Engineer" model used
through Feature 006 was replaced with a permanent, named engineering
organisation (see PROJECT_LOG.md for why). The workflow, quality gates,
and governance below are unchanged in substance by that transition — only
who performs the work, and how that is named and documented, changed.
Team role definitions have moved to ENGINEERING_ORGANISATION.md, so this
document no longer duplicates them.

Version 1.2 records one change: a Scope Assessment and Waiver requirement
was added to the Standard Feature Workflow (Section 6) and Quality Gates
(Section 7). An Engineering Manager governance audit (PROJECT_LOG.md,
2026-07-18) found that across Feature 007's Milestones 5-7, the Test
Engineer step of Section 6 had gone silently undispatched, and the Code
Reviewer had been informally used outside its written, Python-only
charter — in both cases without the Human approval Section 5 already
required for exactly this kind of change, and without either Human
Approval Brief disclosing it. This version closes that gap: a workflow
step or an agent's scope may still turn out not to apply to a given
feature, but that determination is now always recorded and always
Human-approved before the process proceeds without it, never silently
decided by the Engineering Manager alone. The workflow and quality gates
are otherwise unchanged in substance.

## 2. Team Roles

Team roles — the Engineering Manager and the specialist roles that
support it — are fully defined in ENGINEERING_ORGANISATION.md, the
authoritative Damopool engineering organisation handbook. That document
covers purpose, responsibilities, authority, inputs, outputs, file
boundaries, and communication paths for every role. It does not redefine
workflow, quality gates, or governance; those remain exactly as recorded
in this document.

**Human (Project Owner)** — holds final authority over the project.
Approves feature scope where it is not already an established analogue of
prior approved work, approves the Human Approval Brief, and authorizes
every commit, every push, and every ROADMAP.md completion mark.

## 3. Authority Levels

This section states the same authority boundaries that applied under the
Lead Engineer model, unchanged in substance, with roles renamed to match
ENGINEERING_ORGANISATION.md. See that document for the full per-role
breakdown (including roles beyond the two listed here) of inputs,
outputs, and file boundaries.

**Human authority (non-delegable):**
- Approving a Human Approval Brief
- Authorizing commits
- Authorizing pushes
- Marking a feature Completed in ROADMAP.md
- Resolving scope or timing decisions with no precedent in prior approved
  work

**Engineering Manager authority (exercised without per-step human
approval, once a feature's scope is established — this is the same
authority the Lead Engineer held; only the name changed):**
- Designing a feature that closely mirrors the structure of an
  already-approved prior feature
- Implementing production code
- Creating and running tests
- Invoking the Test Engineer
- Fixing Blocking and Major findings
- Re-running tests
- Invoking the Code Reviewer
- Resolving Code Reviewer findings
- Updating PROJECT_LOG.md and other project documentation

**Subagent authority (Test Engineer, Code Reviewer):**
- Read-only access to the codebase, plus (Test Engineer only) the ability
  to write test files and run them
- No ability to modify production code
- No ability to invoke other agents
- No ability to commit, push, or modify project governance documents

## 4. Approval Memory

Design decisions, once made, are recorded in PROJECT_LOG.md under a
feature's entry and marked "status: Design Completed." A decision recorded
this way is treated as settled and is not re-argued during implementation
or review — subsequent independent reviews are told the decision is
approved and are asked only to verify the code correctly implements it,
not to relitigate whether it is correct.

Findings that are not fixed immediately (typically Minor findings judged
to be architectural debt, forward-looking notes, or genuine judgment
calls) are explicitly recorded in PROJECT_LOG.md as "carried forward, not
blocking" rather than silently dropped or silently fixed without a record.

Lessons from one feature's findings are applied proactively in later
features without waiting to be told again. For example, after Feature 003
found that username validation needed to strip whitespace for the check
without altering stored values, Feature 004 applied the identical pattern
to workername validation from the start, and this was recorded as a
deliberate application of a prior lesson in PROJECT_LOG.md.

ROADMAP.md's per-feature Status field is the durable, human-controlled
record of what has actually shipped.

## 5. Permanent Human Governance

Regardless of how much of a feature's design, implementation, and review
cycle proceeds without per-step approval, the following remain under
explicit human control at all times and have not been delegated in any
feature to date:

- Committing changes to git
- Pushing to the remote repository
- Marking a feature Completed in ROADMAP.md
- Modifying CLAUDE.md
- Modifying this document (DEVELOPMENT_PROCESS.md)
- Modifying ENGINEERING_ORGANISATION.md
- Modifying any agent definition, including creating a new one for a
  currently-delegatable or future-placeholder role described in
  ENGINEERING_ORGANISATION.md
- Deleting project files
- Changing the code of a previously shipped feature, except to fix a
  verified regression introduced by the current feature
- Any public interface change with no precedent in prior approved work
- Any major architectural change with no precedent in prior approved work
- Resolving scope or sequencing questions that have no precedent in
  already-approved work (in practice, raised via a clarifying question to
  the human rather than assumed)

This boundary was also stated as an explicit constraint for Feature 004
("Controlled Autonomy Trial") and was upheld: design, implementation,
testing, fixing, and review all proceeded without per-step approval, while
commit, push, and the ROADMAP.md status change were held for a separate,
explicit human approval.

## 6. Standard Feature Workflow

1. Identify the approved scope from ROADMAP.md and CLAUDE.md, and from any
   design decisions already recorded in PROJECT_LOG.md.
2. If no design has been recorded yet, design the feature — mirroring the
   closest already-shipped analogue where one exists — and record the
   approved design in PROJECT_LOG.md before implementation begins. Where
   scope is genuinely ambiguous and has no precedent, ask the human before
   proceeding.
3. Implement production code, reusing already-tested validation and math
   primitives from prior features rather than duplicating their logic.
4. Manually sanity-check the implementation (synthetic data, and a
   read-only run against real production data) before involving the Test
   Engineer.
5. Before invoking the Test Engineer or the Code Reviewer, record a Scope
   Assessment: does the work under review fall within that agent's
   written charter (its `.claude/agents/*.md` definition and the
   corresponding ENGINEERING_ORGANISATION.md section)? If yes, proceed to
   invoke it (steps 6 and 9 below). If no, do not silently omit the step
   and do not substitute another agent outside its own written charter.
   Instead, present the human an explicit Waiver Request: which control
   cannot apply, why, what (if anything) is proposed as a substitute for
   this instance only, and what independent check will not occur as a
   result. Proceed past this step only after the human explicitly
   approves that specific waiver — a prior, unrelated approval (for
   example, a commit or push authorization) does not constitute one.
   Every waiver granted is recorded in PROJECT_LOG.md against the
   milestone or feature it applies to, and reflected in the Human
   Approval Brief per Section 9.
6. Invoke the Test Engineer with full context: the files under test, the
   files they depend on, the approved design decisions, and specific focus
   areas.
7. Report the Test Engineer's findings, classified by severity.
8. Resolve every Blocking and Major finding, verifying each fix directly
   rather than assuming the fix is correct.
9. Re-run the full test suite (and, where the first Test Engineer pass
   found Blocking issues, send the fixes back to the same Test Engineer
   for independent re-verification) to confirm the fixes and rule out
   regressions.
10. Invoke the Code Reviewer only once every Blocking and Major finding
    from step 8 has actually been fixed and re-verified — invoking it
    against code that still has known unfixed issues produces a stale
    review that has to be repeated.
11. Resolve every Blocking and Major finding from the Code Reviewer. Minor
    findings that are cheap, unambiguous, and necessary for the feature to
    be committable (for example, a missing .gitignore allowlist entry) are
    fixed immediately; other Minor findings are recorded as known
    limitations.
12. Where fixes were made after a review pass, re-test and, if warranted,
    request a fresh review pass rather than relying on a review of
    since-changed code.
13. Update PROJECT_LOG.md with the full narrative: design decisions,
    implementation summary, findings from each round of testing and
    review, fixes applied, and any findings carried forward.
14. Produce a Human Approval Brief (see section 9) and stop.
15. On explicit human approval, commit. Push only on a separate or
    combined explicit instruction. Mark the feature Completed in
    ROADMAP.md as part of the same approved action.

## 7. Quality Gates

Before a Human Approval Brief is presented, every one of the following
must be true:

1. Implementation is complete.
2. A Scope Assessment (Section 6, step 5) has been recorded for both the
   Test Engineer and the Code Reviewer. Any control that does not apply
   per its written charter has an explicit, human-approved Waiver on
   record — never silently omitted or silently substituted.
3. An independent Test Engineer review has been performed, or its
   omission is covered by an approved Waiver from gate 2.
4. Every Blocking and Major issue found (where a Test Engineer review was
   performed) has been resolved.
5. An independent re-test has confirmed the fixes and found no
   regressions (where a Test Engineer review was performed).
6. An independent Code Reviewer review has been performed, or any use of
   it outside its written charter is covered by an approved Waiver from
   gate 2.
7. Every Blocking and Major issue found has been resolved.
8. A final re-test has been performed if any code changed after the
   review.
9. PROJECT_LOG.md has been updated to reflect the above, including any
   Waivers granted.

## 8. Progress Reporting

- The human is told, briefly, when a subagent is launched and what it is
  doing, before its result is known.
- Subagent findings are never predicted, assumed, or fabricated ahead of
  the actual result; they are reported only once the subagent's output has
  actually been received.
- Findings are reported with their severity classification intact
  (Blocking / Major / Minor), not summarized away.
- State changes that would be hard to reverse or that assert a feature is
  further along than independently confirmed (for example, marking
  ROADMAP.md Completed) are not made while a relevant review is still in
  progress; where this creates a timing choice, the human is asked rather
  than the Engineering Manager guessing.
- Status updates are concise: what changed, what was found, what happens
  next.

## 9. Human Approval Brief Requirements

Every feature's final Human Approval Brief has consistently included:

- Feature Summary
- Files Changed
- Tests Created
- Tests Executed
- Test Results
- Scope Assessments and Waivers (any control that did not apply per its
  written charter, per Section 6 step 5 — never left implicit by simply
  omitting the line below it)
- Test Engineer Recommendation
- Code Reviewer Recommendation
- Remaining Known Limitations
- Documentation Updated
- Git Status

Where a Waiver applies, the corresponding recommendation line states
"N/A — waived" and points to the recorded Scope Assessment, rather than
being silently omitted from the Brief.

Test Engineer and Code Reviewer reports have consistently closed with one
of three recommendations: **APPROVE**, **APPROVE WITH KNOWN LIMITATIONS**,
or **DO NOT APPROVE**.

Beginning with Feature 004 (run as a "Controlled Autonomy Trial"), the
Human Approval Brief additionally included an Engineering Metrics section
(elapsed time, approximate AI working time, approximate tokens consumed,
human interruptions, number of approvals requested) and a Controlled
Autonomy Assessment section (autonomous decisions made, where human
boundaries were required, and recommendations for future autonomy), and
the brief itself closed with the same three-way recommendation line used
by the subagents. Features 002 and 003 did not include these additional
sections.

## 10. Engineering Principles

- Build incrementally; each step is testable before the next begins.
- Reuse already-tested validation and math primitives across features
  rather than reimplementing them.
- Prefer separate files and small functions; keep frontend and backend
  work separate.
- Validation at a data boundary (for example, a username or workername
  field) strips only to decide validity — it never alters the value that
  is stored or returned.
- Previously shipped feature files are not modified except to fix a
  verified regression introduced by the current feature; this is checked
  directly (for example, via `git diff` against the last commit) rather
  than assumed.
- Every finding from Test Engineer or Code Reviewer is classified by
  severity; Blocking and Major findings are always resolved before
  proceeding, Minor findings are either fixed immediately (if cheap and
  unambiguous) or explicitly carried forward in PROJECT_LOG.md, never
  silently dropped.
- Fixes are independently verified — by direct testing of the specific
  scenario, not merely by re-reading the code — before being reported as
  resolved.
- Reported metrics and claims are only as precise as what is actually
  measured; where a figure cannot be measured (for example, wall-clock
  human waiting time), that limitation is stated rather than a number
  being invented.
- Production data and already-shipped output formats (pool_stats.json,
  historical_data.json, the existing parse_pool_stats.py parser) are never
  touched by this workflow.
