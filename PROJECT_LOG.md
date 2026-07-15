# Project Log

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
