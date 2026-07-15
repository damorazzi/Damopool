# Damopool Project

## Purpose

This repository contains the operational Damopool CKPool solo mining pool and the foundations for a new mining analytics system.

The current pool is working. Stability and reversibility are the highest priorities.

## Production Paths

CKPool project:

/home/damopool/ckpool-solo/ckpool

Existing pool statistics parser:

/home/damopool/ckpool-solo/logs/parse_pool_stats.py

Active CKPool logs:

/home/damopool/ckpool-solo/ckpool/logs

## Existing System

The existing parser reads ckpool.log and generates:

- pool_stats.json
- historical_data.json
- config_history.json
- config_version_log.json

Do not modify the existing parser or those JSON formats unless specifically instructed.

## Analytics Goal

Build a separate Damopool analytics engine using CKPool .sharelog files as the source of truth.

The .sharelog files contain one JSON object per line.

Important fields include:

- username
- workername
- agent
- diff
- sdiff
- result
- createdate
- clientid
- hash

Field meanings:

- diff is the assigned share difficulty
- sdiff is the actual submitted share difficulty
- username identifies the pool user
- workername identifies the individual miner
- agent identifies hardware and firmware
- result indicates whether the share was accepted

## Required Architecture

The analytics system must remain independent from the existing pool statistics parser.

Create a separate parser that will eventually generate:

analytics.json

The system must support:

- pool-wide statistics
- per-user statistics
- per-worker statistics
- average share difficulty
- median share difficulty
- percentiles
- best share today
- best share ever
- daily per-user best
- previous daily best
- daily improvement amount
- daily improvement percentage
- worker model and firmware
- accepted and rejected share counts
- share frequency
- rolling 15-minute, 1-hour and 24-hour windows
- a homepage ticker showing each user’s current daily best and previous daily best

## Safety Rules

Never:

- delete production files
- truncate logs
- stop CKPool
- start CKPool
- modify ckpool.conf
- expose credentials
- modify parse_pool_stats.py
- modify pool_stats.json structure
- modify historical_data.json structure
- run destructive shell commands without explicit approval

Do not use:

- rm -rf
- truncate
- pkill
- killall
- systemctl stop
- shell redirection that overwrites production files

## Development Rules

Build incrementally.

Each step must be testable before moving to the next.

Prefer separate files and small functions.

Do not mix frontend and backend work.

Use copied or sample sharelog data for testing where possible.

Do not write to production JSON files until the parser has been verified.

## Initial Development Plan

1. Inspect the existing repository.
2. Inspect several .sharelog files.
3. Create a separate analytics parser.
4. First version should only read and print parsed share information.
5. Then add pool-level statistics.
6. Then add per-user statistics.
7. Then add per-worker statistics.
8. Then write analytics.json.
9. Website changes come later.
