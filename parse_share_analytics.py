#!/usr/bin/env python3

import argparse
import glob
import json
import os
import sys

LOGS_DIR = "/home/damopool/ckpool-solo/ckpool/logs/"
DEFAULT_LIMIT = 20


def find_sharelog_files(logs_dir):
    pattern = os.path.join(logs_dir, "**", "*.sharelog")
    return sorted(glob.glob(pattern, recursive=True))


def parse_sharelog_file(path):
    try:
        f = open(path, "r", encoding="utf-8")
    except OSError as exc:
        print(f"warning: could not open {path}: {exc}", file=sys.stderr)
        return

    try:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                record = json.loads(line)
            except json.JSONDecodeError:
                continue

            if not record.get("result", False):
                continue

            yield {
                "username": record.get("username"),
                "workername": record.get("workername"),
                "agent": record.get("agent"),
                "diff": record.get("diff"),
                "sdiff": record.get("sdiff"),
                "createdate": record.get("createdate"),
            }
    except OSError as exc:
        print(f"warning: error reading {path}: {exc}", file=sys.stderr)
    finally:
        f.close()


def iter_shares(logs_dir):
    for path in find_sharelog_files(logs_dir):
        for share in parse_sharelog_file(path):
            yield share


def print_share(share):
    print("User:", share["username"])
    print("Worker:", share["workername"])
    print("Miner:", share["agent"])
    print("Assigned Difficulty:", share["diff"])
    print("Actual Difficulty:", share["sdiff"])
    print("Timestamp:", share["createdate"])
    print()


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--limit",
        type=int,
        default=DEFAULT_LIMIT,
        help=f"maximum number of shares to print (default: {DEFAULT_LIMIT})",
    )
    return parser.parse_args()


def main():
    args = parse_args()
    count = 0
    for share in iter_shares(LOGS_DIR):
        if count >= args.limit:
            break
        print_share(share)
        count += 1


if __name__ == "__main__":
    main()
