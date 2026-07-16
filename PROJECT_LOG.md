# Project Log

## 2026-07-16

- Implemented Feature 002 - Pool Statistics per the approved design.
- parse_share_analytics.py modified to stop discarding result=false records and to yield the result field.
- pool_statistics.py created, consuming parse_share_analytics.py's reader; computes accepted/rejected/invalid-result counts, average/median/min/max sdiff, p50/p90/p99 percentiles, best share today, and best share ever.
- Independent test-engineer pass (round 1, 62 tests) found three Blocking crash bugs: non-object JSON lines (bare scalar/null/list) crashing record.get() with AttributeError; invalid UTF-8 bytes in a sharelog line crashing text-mode file iteration with UnicodeDecodeError; unbounded createdate seconds crashing datetime.fromtimestamp() with OSError.
- Fixed all three: parse_share_analytics.py now reads sharelog files in binary mode and decodes each line individually, skipping and logging only the one bad line instead of losing the whole file; added an isinstance(record, dict) guard to skip non-object JSON lines; pool_statistics.py's parse_createdate now rejects seconds above MAX_TIMESTAMP_SECONDS (253,402,300,799 / 9999-12-31T23:59:59 UTC).
- Independent test-engineer pass (round 2, 73 tests) confirmed all three Blocking fixes with no regressions, including stress tests for the encoding fix (interspersed bad lines, bad byte at start/middle/end of line, truncated multi-byte sequence at EOF).
- Independent code-reviewer pass found no Blocking or Major issues; confirmed no references to parse_pool_stats.py, pool_stats.json, or historical_data.json anywhere in the change, and confirmed the implementation matches every design decision recorded above.
- Noted Minor items carried forward, not blocking: _BestTracker tie-break is asymmetric when the existing best has no timestamp; accepted_count can exceed the sdiff sample count backing average/median/percentiles; best_share_ever is scoped only to currently-present .sharelog files pending the persisted-cursor architecture required before Feature 006; clientid and hash are not yet extracted by parse_share_analytics.py, needed ahead of Feature 004; no --logs-dir CLI override yet for manual testing against sample data.
- Committed the regression test suite (73 tests) to tests/test_analytics.py and tests/test_encoding.py; suite uses only synthetic tempfile-based fixture data, never touches the production logs directory, and passes from the project directory via `python3 -m unittest discover -s tests`.
- Feature 002 - Pool Statistics marked Completed in ROADMAP.md.
- Designed Feature 003 - User Statistics, design only, no code written yet.
- Decided Feature 003 covers the same metrics as Feature 002 (accepted/rejected/invalid-result counts, average/median/min/max sdiff, p50/p90/p99 percentiles, best share today, best share ever), grouped per username.
- Decided daily per-user best, previous daily best, daily improvement amount, and daily improvement percentage stay out of Feature 003 and remain owned by Feature 007 - Daily Best Ticker.
- Decided the return shape is a dict keyed by username, each value having the same stat fields as compute_pool_statistics's return value, mirroring the eventual analytics.json "users" section design from Feature 005.
- Decided worker-level breakdown stays out of Feature 003 and is deferred to Feature 004 - Worker Statistics; grouping is purely by username.
- Decided shares with a missing, None, or non-string username are excluded entirely from the per-user breakdown (no entry is created for them), since they cannot be attributed to a user.
- Decided the new module reuses pool_statistics.py's validation and math primitives (is_valid_result, is_valid_sdiff, parse_createdate, createdate_to_utc, percentile, median, _BestTracker) rather than duplicating the already-tested logic; pool_statistics.py itself is not modified.
- Approved design recorded as Feature 003 - User Statistics, status: Design Completed.
- Implemented Feature 003 - User Statistics per the approved design.
- user_statistics.py created, importing pool_statistics.py's validation and math primitives (is_valid_result, is_valid_sdiff, parse_createdate, createdate_to_utc, percentile, median, _BestTracker) rather than duplicating them; pool_statistics.py confirmed unmodified.
- Independent test-engineer pass (27 new tests, 100 total) found no Blocking or Major issues. Two Minor items noted: whitespace-only usernames (e.g. "   ") passed validation and became their own top-level user entry; user_statistics.py was accidentally git-ignored (no .gitignore allowlist entry).
- Resolved both Minor items: added `!/user_statistics.py` to .gitignore alongside the existing parse_share_analytics.py/pool_statistics.py entries; changed is_valid_username() to `isinstance(value, str) and value.strip() != ""` so whitespace-only usernames are excluded, while keeping stripping validation-only so a valid-but-padded username (e.g. " alice ") is still stored verbatim as the dict key and in best_share records.
- Updated the regression suite (tests/test_user_statistics.py) to assert whitespace-only usernames are excluded and that valid padded usernames are not altered in storage; full suite now 101 tests, all passing, run via `python3 -m unittest discover -s tests`.
- Independent code-reviewer pass (round 2, after the fixes) verified both fixes correct by tracing the code, and confirmed no Blocking or Major issues; confirmed no references to parse_pool_stats.py, pool_stats.json, or historical_data.json anywhere in the change.
- Noted Minor items carried forward, not blocking: `users.setdefault(username, _UserAccumulator())` eagerly allocates a throwaway accumulator on every share; per-user unbounded in-memory accumulation multiplies the already-accepted Feature 002 full-rescan memory tradeoff across every distinct username; no --logs-dir CLI override in user_statistics.py's main(), same gap as pool_statistics.py; a username with incidental leading/trailing whitespace (e.g. " alice ") is treated as a wholly separate user from "alice" with independent stats, worth confirming as intended once Feature 007's ticker keys UI off usernames.
- Feature 003 - User Statistics marked Completed in ROADMAP.md.

## 2026-07-15

- Created CLAUDE.md
- Decided to keep parse_pool_stats.py unchanged.
- Decided to build a separate analytics parser.
- Decided to use .sharelog files as the source of truth.
- Decided to leave website changes until later.
- Created parse_share_analytics.py (Feature 001 - Sharelog Reader).
- parse_share_analytics.py reads .sharelog files as JSON Lines.
- parse_share_analytics.py filters records where result is true.
- parse_share_analytics.py extracts username, workername, agent, diff, sdiff and createdate.
- parse_share_analytics.py uses generator-based reading instead of loading records into memory.
- parse_share_analytics.py supports a --limit command-line option.
- Feature 001 passed testing: a 20-share run completed with no errors.
- Designed the analytics.json schema (Feature 005 - analytics.json), design only, no code written.
- Schema includes six sections: metadata, pool, users, workers, daily_bests, live_ticker.
- Defined previous_daily_best as the immediately preceding same-UTC-day daily-best record, not the prior calendar day's final best.
- Defined live_ticker entries to include username, workername, current_daily_best, previous_daily_best, improvement_amount, improvement_percentage and timestamp.
- Decided daily_bests holds only today and optionally yesterday (UTC); older history is deferred to a future, separate analytics_history.json.
- Clarified that future parsing reads both result=true and result=false records; accepted/rejected counts include both, while sdiff statistics use accepted shares only.
- Added first_share_at, last_share_at and is_active fields to worker entries.
- Added average_sdiff to each rolling window (15m, 1h, 24h) for pool, users and workers.
- Approved schema recorded as Feature 005 - analytics.json, status: Design Completed.
- Designed the pool statistics implementation (Feature 002 - Pool Statistics), design only, no code written.
- Design covers accepted/rejected counts, average/median/min/max sdiff, p50/p90/p99, best share today, and best share ever.
- Defined validation as four independent checks per record: result validity, acceptance/rejection, sdiff validity, and createdate validity, each excluding a record only from the statistics that depend on it.
- Decided invalid result records are skipped entirely and counted separately; invalid sdiff and invalid createdate on accepted records do not discard the record, only exclude it from the dependent statistics.
- Decided best_share_ever is a lifetime statistic and remains eligible even with a malformed createdate, recording timestamp as unknown in that case.
- Decided createdate is parsed using both epoch seconds and nanoseconds, preserving sub-second ordering.
- Decided full rescanning of .sharelog files is acceptable only for initial Feature 002 development and testing.
- Decided the approved production architecture is incremental: persisted cursor state per file, truncated/replaced file detection, atomic cursor updates, and avoidance of duplicate share processing, required before Feature 006 - Website Integration.
- Decided pool statistics will be implemented in a new module consuming parse_share_analytics.py's reader, and that parse_share_analytics.py must be modified to stop discarding result=false records and to yield the result field.
- Approved design recorded as Feature 002 - Pool Statistics, status: Design Completed.
