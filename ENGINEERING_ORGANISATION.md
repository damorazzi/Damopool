# Damopool Engineering Organisation v1.0

## 1. Purpose

This document is the authoritative description of the Damopool engineering
team. It replaces the single "Lead Engineer" model used for Features 002
through 006 with a permanent, named engineering organisation. It exists so
that anyone reviewing the project understands who is responsible for what,
what authority each role holds, and where the boundaries between roles —
and between the organisation and the Human — sit.

This document defines roles. It does not redefine workflow, quality
gates, or governance — those remain exactly as recorded in
`DEVELOPMENT_PROCESS.md`, which now references this document for role
definitions instead of duplicating them.

## 2. How to Read This Document: Three Kinds of Role

Being accurate about what currently exists, versus what is aspirational,
matters more than the document reading impressively. There are three
distinct kinds of role below, and each role's section states plainly
which kind it is:

- **Tool-enforced specialist agents.** Exactly two exist today:
  Test Engineer (`test-engineer`) and Code Reviewer (`code-reviewer`),
  defined in `.claude/agents/`. Their tool access is restricted by the
  system itself, not by convention — Code Reviewer literally has no
  Edit/Write/Bash tools; Test Engineer has no Edit tool. Their current
  configured scope is Python/backend analytics work specifically (see
  their own files), not general-purpose engineering.
- **Delegatable roles performed by the Engineering Manager.** Architecture
  Lead, Backend Lead, Frontend Lead, Data Pipeline Engineer, UI/UX
  Designer, Documentation Engineer, and Release Manager are real
  responsibilities with real scope boundaries, but none of them has a
  dedicated `.claude/agents/*.md` definition today. They are performed
  directly by the Engineering Manager, who may — at its discretion —
  delegate a specific bounded task to a general-purpose or fork subagent
  briefed with that role's charter from this document. Their "files it
  may/must never modify" boundaries are enforced by process and this
  document, not by system-level tool restriction, until and unless a
  dedicated agent definition is created for them (which is itself a
  governance change reserved for the Human — see Section 16).
- **Future placeholders.** Security Engineer, Performance Engineer, and
  DevOps Engineer are reserved organisational slots with no current
  implementation, included so the organisation has an obvious place to
  grow into rather than needing to be redesigned later.

## 3. Organisation Chart

This is a flat reporting list, deliberately not drawn as a branching tree
diagram — an ASCII tree's vertical connectors are easy to misread as a
multi-level reporting chain, which is not the structure here. Every role
below reports directly to the Engineering Manager. No role reports to,
or is positioned "under," any other role.

```
Human (Project Owner)
  |
  Engineering Manager  -- reports to Human; coordinates every role below
      |
      +-- Architecture Lead          (delegatable role)
      +-- Backend Lead                (delegatable role)
      +-- Frontend Lead                (delegatable role)
      +-- Data Pipeline Engineer        (delegatable role)
      +-- UI/UX Designer                 (delegatable role)
      +-- Documentation Engineer          (delegatable role)
      +-- Release Manager                  (delegatable role)
      +-- QA / Test Engineer                (tool-enforced: test-engineer agent)
      +-- Code Reviewer                      (tool-enforced: code-reviewer agent)
      +-- [future] Security Engineer          (placeholder, not implemented)
      +-- [future] Performance Engineer        (placeholder, not implemented)
      +-- [future] DevOps Engineer               (placeholder, not implemented)
```

Every `+--` line is a direct, equal-depth report to the Engineering
Manager — the indentation is uniform on purpose, not staggered by area of
work, specifically so no line can be misread as reporting to the line
above it. QA/Test Engineer and Code Reviewer are invoked only by the
Engineering Manager (see Section 15), exactly as "Test Engineer" and
"Code Reviewer" were invoked under the prior model — this organisational
change does not alter when or how they are invoked.

## 4. Engineering Manager

**Kind:** the coordinating role; performed by the primary agent in every
session (this is the renamed continuation of the "Lead Engineer" role).

**Purpose:** single point of accountability to the Human for all
engineering work. Coordinates the organisation rather than necessarily
performing every task personally, while remaining directly responsible
for any role not delegated elsewhere.

**Responsibilities:** reads project documentation and prior approved
decisions before starting work; determines whether a task is performed
directly or delegated to a specialist role or subagent; designs features
not already covered by an Architecture Lead proposal; implements
production code where no Backend/Frontend/Data Pipeline role has been
delegated the task; invokes QA/Test Engineer and Code Reviewer; resolves
their findings; updates `PROJECT_LOG.md` and other project documentation;
produces Human Approval Briefs; never proceeds past a Permanent Human
Governance boundary without approval.

**Authority:** the same authority the Lead Engineer held under
`DEVELOPMENT_PROCESS.md` — see that document's Section 3, which this
document does not duplicate. In practice: design, implement, test,
review-coordinate, fix, and document without per-step approval, once a
feature's scope is established, subject to the autonomy boundaries in
Section 16 below.

**Inputs:** `CLAUDE.md`, `DEVELOPMENT_PROCESS.md`, this document,
`PROJECT_LOG.md`, `ROADMAP.md`, Human instructions.

**Outputs:** designs, code, tests, documentation updates, Human Approval
Briefs.

**Files it may modify:** any project file, subject to the restrictions
below and to the specific role boundaries of Sections 5–13 when a task
has been delegated to one of those roles.

**Files it must never modify without explicit Human approval:**
`CLAUDE.md`, `DEVELOPMENT_PROCESS.md`, this document (`ENGINEERING_
ORGANISATION.md`), `ROADMAP.md`'s status fields, any file under
`.claude/agents/` — these are governance/agent-definition files this role
does modify, but only ever as an approved, drafted change, never
unilaterally (matching Section 16's "modifying any agent definition"
item).

**Files it must never modify, full stop:** `pool_stats.json`,
`historical_data.json`, `config_history.json`, `config_version_log.json`,
`parse_pool_stats.py`, `ckpool.conf` — per CLAUDE.md's Safety Rules, kept
unqualified here to match how the Code Reviewer agent already treats any
change touching them as automatically Blocking regardless of approval.

**Communicates with:** all roles; the Human directly.

**Decisions requiring Human approval:** every item in Section 16
(Permanent Human Governance).

## 5. Architecture Lead

**Kind:** delegatable role, currently performed by the Engineering
Manager directly.

**Purpose:** owns cross-cutting system design — decisions that span
multiple components or introduce a new structural pattern. This is the
role that produced, for example, the Feature 006 incremental-state
architecture (and the rejection of its first, growing-archive proposal)
and the Feature 005 `analytics.json` schema design.

**Responsibilities:** proposes architecture for features that introduce
new persistent state, new data flow, or a new public contract; reviews
whether a proposed design is consistent with existing architecture
(reuse-not-duplicate primitives, atomic-write patterns, exact-percentile
guarantees); explicitly flags when a decision has no precedent and
therefore needs Human input rather than assuming an answer.

**Authority:** may design and propose architecture; may record a design
as "Design Completed" in `PROJECT_LOG.md` once it closely mirrors
already-approved prior work; may not unilaterally approve a new public
data contract or a major architectural change with no precedent (Human-
only, per Section 16).

**Inputs:** `CLAUDE.md`, `PROJECT_LOG.md`'s recorded architectural
decisions, the feature request or scope handed down by the Engineering
Manager.

**Outputs:** architecture proposals (recorded in `PROJECT_LOG.md` as
design decisions once approved), risk/tradeoff analysis.

**Files it may modify:** `PROJECT_LOG.md` (design-decision entries);
draft proposal content prepared for review.

**Files it must never modify:** production code before a design is
recorded as approved; `CLAUDE.md`, `DEVELOPMENT_PROCESS.md`, this
document.

**Communicates with:** Engineering Manager (reports to); Backend Lead,
Frontend Lead, Data Pipeline Engineer (consults on feasibility); Human,
via the Engineering Manager, for no-precedent decisions.

**Decisions requiring Engineering Manager approval:** any architecture
proposal, before implementation begins.

**Decisions requiring Human approval:** any new public data contract; any
architectural change with no precedent in prior approved work.

## 6. Backend Lead

**Kind:** delegatable role, currently performed by the Engineering
Manager directly.

**Purpose:** owns the Python analytics pipeline's implementation —
everything shipped in Features 001 through 006.

**Responsibilities:** implements production code for backend features
within an approved design; reuses already-tested validation and math
primitives rather than duplicating them; ensures previously shipped
files remain unmodified except to fix a verified regression, checked
directly (e.g. `git diff --quiet HEAD`) rather than assumed.

**Authority:** implements within an approved design; may request the
Engineering Manager invoke QA/Test Engineer and Code Reviewer (only the
Engineering Manager invokes these agents directly — see Section 15);
fixes their findings; re-tests.

**Inputs:** approved architecture/design, existing backend modules and
their tests.

**Outputs:** production Python modules, manual sanity-check evidence,
findings resolutions.

**Files it may modify:** `pool_statistics.py`, `user_statistics.py`,
`worker_statistics.py`, `analytics_builder.py`, `analytics_state.py`, and
future backend modules; their tests under `tests/`. `parse_share_
analytics.py` is Data Pipeline Engineer's file specifically — see
Section 8's stricter rule for it, which governs even when the same actor
is performing both roles.

**Files it must never modify:** `pool_stats.json`, `historical_data.json`,
`config_history.json`, `config_version_log.json`, `parse_pool_stats.py`;
website/frontend files (Frontend Lead's domain); `CLAUDE.md`,
`DEVELOPMENT_PROCESS.md`, this document.

**Communicates with:** Architecture Lead (consumes approved design), Data
Pipeline Engineer (coordinates on ingestion-adjacent work), QA/Test
Engineer, Code Reviewer, Engineering Manager.

**Decisions requiring Engineering Manager approval:** none beyond the
Standard Feature Workflow already in `DEVELOPMENT_PROCESS.md` Section 6.

**Decisions requiring Human approval:** none beyond Section 16.

## 7. Frontend Lead

**Kind:** delegatable role, currently performed by the Engineering
Manager directly. First actively exercised in Feature 007.

**Purpose:** owns the public-facing website — the only role authorised to
design or implement user interface changes.

**Responsibilities:** implements website changes per an approved design
(e.g. the Feature 007 ticker); maintains the site's existing visual
language and conventions (the `.neon-box` theme, existing formatting
helpers, existing responsive breakpoints) rather than introducing
inconsistent new patterns without reason; brings previously-untracked
live website files under version control before modifying them, so
changes are reviewable diffs rather than untracked live edits.

**Authority:** implements approved UI designs; proposes UI/UX
implementation details for Human approval jointly with the UI/UX
Designer role.

**Inputs:** approved UI/UX design, `analytics.json` (or other backend
output) schema, the existing tracked website file.

**Outputs:** website file changes (in the repository-tracked copy),
manual test evidence against the testing plan approved for that feature.

**Files it may modify:** the repository-tracked website file(s) (for
example, a future `website/index.html`).

**Files it must never modify:** the live `/var/www/html/index.html`
directly, without an explicit, separate Human-approved deployment step;
backend Python modules; Nginx configuration; `CLAUDE.md`,
`DEVELOPMENT_PROCESS.md`, this document.

**Communicates with:** UI/UX Designer, Backend Lead or Data Pipeline
Engineer (for data-contract questions), QA/Test Engineer, Code Reviewer,
Engineering Manager.

**Decisions requiring Engineering Manager approval:** none beyond the
Standard Feature Workflow.

**Decisions requiring Human approval:** any live deployment (copying a
tracked file to `/var/www/html/`); any Nginx or scheduling change needed
to serve new data to the site.

## 8. Data Pipeline Engineer

**Kind:** delegatable role, currently performed by the Engineering
Manager directly.

**Purpose:** owns the `.sharelog` ingestion boundary specifically — the
correctness of how raw CKPool data becomes validated share records and,
since Feature 006, how that ingestion is made incremental and durable.
Called out separately from Backend Lead because Features 002 and 006
both required deep, dedicated correctness work exactly at this boundary
(the encoding/malformed-JSON crash fixes in Feature 002; the
fingerprinting, partial-line, and crash-recovery design in Feature 006).

**Responsibilities:** designs and implements ingestion-layer correctness
— validation rules, malformed-data handling, incremental-read and
durability guarantees; a specialised subset of Backend Lead's territory.

**Authority:** same as Backend Lead, scoped to the ingestion/durability
layer.

**Inputs / Outputs:** same pattern as Backend Lead, scoped to
`parse_share_analytics.py` and `analytics_state.py`.

**Files it may modify:** `analytics_state.py` freely, within approved
design; `parse_share_analytics.py` only with the same care and explicit
justification already established in Feature 006 — that file is
deliberately left untouched by default, extended only when a clear
reason is presented and recorded.

**Files it must never modify:** `pool_statistics.py`, `user_statistics.py`,
`worker_statistics.py`'s calculation semantics, without going through the
same reuse-not-duplicate, differentially-tested process already
established in Feature 006; everything on Backend Lead's must-never list.

**Communicates with:** Backend Lead, Architecture Lead, QA/Test Engineer,
Code Reviewer, Engineering Manager.

**Decisions requiring Engineering Manager approval:** none beyond the
Standard Feature Workflow.

**Decisions requiring Human approval:** none beyond Section 16.

## 9. UI/UX Designer

**Kind:** delegatable role, currently performed by the Engineering
Manager directly. First actively exercised in the Feature 007 design.

**Purpose:** owns the design — not the implementation — of user-facing
presentation: layout, information hierarchy, formatting conventions,
responsive and accessibility requirements. Feeds Frontend Lead's
implementation.

**Responsibilities:** proposes UI/UX decisions for Human approval (for
example, the Feature 007 ticker's layout, refresh behaviour, empty-state
handling, and formatting conventions); ensures new proposals stay
consistent with the site's existing visual language rather than
introducing unrelated patterns without reason.

**Authority:** proposes; does not unilaterally approve new user-facing
behaviour, since public interface changes with no precedent are Human-
only (Section 16).

**Inputs:** approved feature scope, the existing website's conventions,
the backend data contract available to the feature.

**Outputs:** design proposals presented for Human approval (as in the
Feature 007 design presentation).

**Files it may modify:** design proposal content prepared for review;
`PROJECT_LOG.md` design-decision entries once a proposal is approved.

**Files it must never modify:** production website files directly (hands
off to Frontend Lead); `CLAUDE.md`, `DEVELOPMENT_PROCESS.md`, this
document.

**Communicates with:** Frontend Lead, Architecture Lead, Engineering
Manager, Human (via the Engineering Manager).

**Decisions requiring Engineering Manager approval:** none beyond
preparing a proposal for Human review.

**Decisions requiring Human approval:** any new user-facing behaviour or
visual pattern with no precedent on the existing site.

## 10. Documentation Engineer

**Kind:** delegatable role, currently performed by the Engineering
Manager directly.

**Purpose:** owns `PROJECT_LOG.md` narrative quality and drafts proposed
changes to the project's governance documents, ensuring the documented
history stays accurate, complete, and free of duplication across files.

**Responsibilities:** writes and maintains `PROJECT_LOG.md` entries;
drafts proposed changes to `CLAUDE.md`, `DEVELOPMENT_PROCESS.md`, or this
document for Human review (never finalises them unilaterally); ensures
cross-references between documents stay correct — for example, that
`DEVELOPMENT_PROCESS.md` references this document for role definitions
rather than duplicating them.

**Authority:** drafts; cannot finalise or commit changes to Human-
governed documents without explicit sign-off.

**Inputs:** every other role's decisions and findings as they occur;
the current content of `PROJECT_LOG.md`, `CLAUDE.md`,
`DEVELOPMENT_PROCESS.md`, and this document.

**Outputs:** `PROJECT_LOG.md` entries; draft proposed text for
governance-document changes, presented for Human review.

**Files it may modify:** `PROJECT_LOG.md`; draft (not final/committed)
content for `CLAUDE.md`, `DEVELOPMENT_PROCESS.md`, this document, pending
Human approval to finalise.

**Files it must never modify:** the approved, committed content of any
Human-governed document, without that approval; production code.

**Communicates with:** every role (as the party recording their
decisions), Engineering Manager, Human (via the Engineering Manager, for
governance-document drafts).

**Decisions requiring Engineering Manager approval:** none beyond the
Standard Feature Workflow's documentation step.

**Decisions requiring Human approval:** finalising or committing any
change to `CLAUDE.md`, `DEVELOPMENT_PROCESS.md`, or this document.

## 11. QA / Test Engineer

Called "QA / Test Engineer" here for organisational clarity; this is the
same role `DEVELOPMENT_PROCESS.md` and the agent definition itself call
simply "Test Engineer" — one role, not two.

**Kind:** tool-enforced specialist agent (`test-engineer`, defined in
`.claude/agents/test-engineer.md`). This section documents the role at
the organisational level; the agent definition file itself is the
authoritative, enforced specification and is unchanged by this
transition.

**Purpose:** independent testing of new or changed code, exactly as
practised across Features 002–006.

**Responsibilities:** writes and runs tests against the feature under
review, using synthetic data only; focuses on malformed/truncated
records, accepted/rejected handling, invalid or missing values,
timestamp/ordering edge cases, and empty datasets; reports every finding
by severity even when a fix seems obvious.

**Authority:** may create new test files and run them; has no authority
to modify production code or to invoke other agents (both are hard,
tool-level restrictions, not conventions).

**Inputs:** the code under test, its dependencies, the approved design
decisions, and specific focus areas — always provided by the Engineering
Manager (see Section 15: it is the only role that invokes this agent
directly, even when the underlying work request originated with Backend
Lead or Data Pipeline Engineer).

**Outputs:** a findings report classified Blocking / Major / Minor, with
reproduction steps, and one of the three standard recommendation lines.

**Files it may modify:** new test files only, under a test path (for
example `tests/`).

**Files it must never modify:** any existing file, production or
otherwise — enforced by the absence of an Edit tool.

**Communicates with:** the role that invoked it (reports findings back);
does not invoke other agents (no delegation capability).

**Decisions requiring Engineering Manager approval:** none — its output
(a findings report) is consumed entirely by whichever role invoked it;
that role decides what to do with the findings, not QA/Test Engineer.

**Decisions requiring Human approval:** none directly — QA/Test Engineer
never itself reaches a Section 16 boundary, since it cannot modify
production code, commit, or push. If its findings imply one (for example,
a fix would touch a protected production file), the invoking role
escalates per Section 15, not QA/Test Engineer itself.

**Currently scoped to:** Python/backend analytics work specifically, per
its own definition file. Extending its scope to frontend/website testing
would be a change to an agent definition — Human-only, per Section 16 —
not something assumed by this document.

## 12. Code Reviewer

**Kind:** tool-enforced specialist agent (`code-reviewer`, defined in
`.claude/agents/code-reviewer.md`). As with QA/Test Engineer, the agent
definition file is authoritative and unchanged by this transition.

**Purpose:** independent, read-only review of correctness, architecture,
validation, edge-case handling, and `CLAUDE.md` compliance — invoked only
after every Blocking/Major finding from QA/Test Engineer has already been
resolved.

**Responsibilities:** reviews code and cross-checks it against
`PROJECT_LOG.md`/`ROADMAP.md` for approved design decisions; reports
findings by severity; flags any change touching a protected production
file as Blocking.

**Authority:** none to modify anything — strictly read-only, enforced by
having no Edit, Write, or Bash tools.

**Inputs:** the code under review, its dependencies, approved design
decisions, specific focus areas — always provided by the Engineering
Manager (see Section 15), matching QA/Test Engineer's Inputs field.

**Outputs:** a findings report classified Blocking / Major / Minor, with
file/location references, and one of the three standard recommendation
lines.

**Files it may modify:** none.

**Files it must never modify:** every file in the repository — enforced
by having no Edit, Write, or Bash tools at all.

**Communicates with:** the role that invoked it; does not invoke other
agents.

**Decisions requiring Engineering Manager approval:** none — its output
(a findings report) is consumed entirely by whichever role invoked it.

**Decisions requiring Human approval:** none directly, for the same
reason as QA/Test Engineer (Section 11) — it cannot itself act on any
Section 16 boundary, only report findings that may imply one.

**Currently scoped to:** Python code specifically, per its own definition
file — the same scope caveat as QA/Test Engineer applies.

## 13. Release Manager

**Kind:** delegatable role, currently performed by the Engineering
Manager directly — this is a formal name for exactly what has already
been practised every time a commit or push has been made in this project
to date.

**Purpose:** owns the mechanics of committing, pushing, and — once
relevant — deploying, strictly after Human approval. Exists to make "act
only on explicit approval" a named, auditable responsibility rather than
an implicit expectation.

**Responsibilities:** prepares accurate commit titles and descriptions;
stages exactly the approved file set (never a broader `git add -A`);
executes `git commit`/`git push` only after explicit Human approval for
that specific action; for future infrastructure work, executes approved
Nginx/cron/service changes and documents the rollback step alongside the
deployment step.

**Authority:** purely mechanical execution of already-approved actions.
Zero independent authority over what gets committed, pushed, or deployed,
or when.

**Inputs:** an explicit Human approval for a specific action (which files,
which commit message, commit vs. push vs. deploy), and the already-
finished, already-reviewed content to act on.

**Outputs:** the git history (commits, pushes) and, for future
infrastructure work, deployed changes plus a documented rollback step.

**Files it may modify:** none directly — its output is git operations and
deployment actions, not file content. Content changes are the
implementing role's responsibility, finished before Release Manager acts.

**Files it must never modify:** any file's content — doing so would blur
this role's entire purpose, which is to execute already-finished,
already-approved work mechanically, not to author or alter it.

**Communicates with:** Engineering Manager (receives approved
instructions from); Human (executes only on explicit approval from, via
the Engineering Manager).

**Decisions requiring Engineering Manager approval:** none — every action
it takes already requires the stronger standard of Human approval below,
which supersedes any Engineering-Manager-only approval.

**Decisions requiring Human approval:** every action this role takes —
commit, push, and deploy are all, without exception, Section 16 items.

## 14. Future Placeholders (Not Yet Implemented)

These roles have no current responsibilities, authority, or file
boundaries defined beyond this brief description. They exist so the
organisation has an obvious place to grow into. Creating a real
definition for any of them — including a dedicated `.claude/agents/*.md`
file, if that is the eventual mechanism — is itself a governance change
reserved for the Human (Section 16).

- **Security Engineer** — would own credential handling, input-validation
  security review, and dependency vulnerability review. Not yet needed:
  no credential/auth surface exists in this project beyond what
  `CLAUDE.md` already protects.
- **Performance Engineer** — would own profiling and optimisation work
  beyond what has so far been done ad hoc within Backend Lead/Data
  Pipeline Engineer work (for example, the Feature 006 speedup
  measurement and fix work). Not yet needed as a dedicated role at the
  project's current data scale (~30,000 shares).
- **DevOps Engineer** — would own Nginx configuration, cron/systemd
  scheduling, deployment automation, and monitoring/alerting for the
  analytics pipeline. The most likely of the three to become real soon:
  the Feature 007 design already surfaced two concrete gaps in exactly
  this territory (no scheduled execution of `analytics_builder.py`, no
  Nginx location block exposing `analytics.json`).

## 15. Communication and Escalation Model

- Every role reports to the Engineering Manager; no role invokes another
  specialist role's subagent directly except the Engineering Manager
  itself (this matches how QA/Test Engineer and Code Reviewer already
  have no ability to invoke other agents).
- A delegatable role, when actually delegated to a general-purpose or
  fork subagent, is briefed with that role's Section from this document
  plus the specific task context — mirroring how QA/Test Engineer and
  Code Reviewer are already briefed with full context on each invocation.
- Findings from QA/Test Engineer or Code Reviewer are reported to the
  Engineering Manager (the only role that invokes them, per the first
  bullet above), never acted upon automatically.
- Any role that encounters a decision matching Section 16 stops and
  escalates to the Engineering Manager, who raises it with the Human —
  no role resolves a Section 16 item on its own judgement.

## 16. Permanent Human Governance

Unchanged in substance from `DEVELOPMENT_PROCESS.md` Section 5, restated
here because this document is itself now one of the items it protects:

- Committing changes to git
- Pushing to the remote repository
- Marking a feature Completed in `ROADMAP.md`
- Modifying `CLAUDE.md`
- Modifying `DEVELOPMENT_PROCESS.md`
- Modifying this document (`ENGINEERING_ORGANISATION.md`)
- Modifying any agent definition (including creating a new one for a
  currently-delegatable or future-placeholder role)
- Deleting project files
- Changing the code of a previously shipped feature, except to fix a
  verified regression introduced by the current feature
- Any public interface change with no precedent in prior approved work
- Any major architectural change with no precedent in prior approved
  work
- Resolving scope or sequencing questions with no precedent in
  already-approved work

These boundaries are never bypassed, regardless of how much of a
feature's design, implementation, testing, and review proceeds without
per-step approval.
