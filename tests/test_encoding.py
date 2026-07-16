#!/usr/bin/env python3
"""
Additional coverage: invalid-byte / non-UTF-8 sharelog lines.

Uses only synthetic fixture data written to a scratch temp directory.
"""
import json
import os
import shutil
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import parse_share_analytics as psa


def good_line(username):
    return json.dumps({"username": username, "result": True, "sdiff": 1.0,
                        "createdate": "1700000000,0"}).encode("utf-8")


class TestInvalidEncoding(unittest.TestCase):
    def setUp(self):
        self.tmpdir = tempfile.mkdtemp(prefix="damopool_test_enc_")

    def tearDown(self):
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    # -- FIX VERIFICATION ----------------------------------------------------
    def test_non_utf8_bytes_in_a_line_no_longer_crash_the_parser(self):
        """
        FIX VERIFIED: parse_sharelog_file now reads in binary mode and
        decodes each line individually, catching UnicodeDecodeError per
        line and skipping just that line (with a stderr warning) instead of
        crashing the whole generator. Previously this raised an uncaught
        UnicodeDecodeError from the text-mode line iterator (Blocking
        finding #2).
        """
        path = os.path.join(self.tmpdir, "bad_encoding.sharelog")
        with open(path, "wb") as f:
            f.write(good_line("good1") + b"\n")
            f.write(b"\xff\xfe garbage invalid utf8 \x80\x81\n")
            f.write(good_line("good2") + b"\n")

        shares = list(psa.iter_shares(self.tmpdir))
        usernames = [s["username"] for s in shares]
        self.assertEqual(usernames, ["good1", "good2"])

    def test_many_surrounding_lines_are_not_dropped_by_one_bad_line(self):
        """
        Stress test for the specific regression the coordinator flagged in
        their first fix attempt: confirm that a bad-byte line in the middle
        of a large batch does not corrupt the buffered read and does not
        cause silent loss of unrelated surrounding lines. Uses 50 good
        lines before and 50 good lines after a single bad line, and checks
        the exact count and exact order survive intact.
        """
        path = os.path.join(self.tmpdir, "bad_encoding_stress.sharelog")
        before = [f"before_{i}" for i in range(50)]
        after = [f"after_{i}" for i in range(50)]
        with open(path, "wb") as f:
            for name in before:
                f.write(good_line(name) + b"\n")
            f.write(b"\xff\xfe\x80\x81 not valid utf8 at all \xc0\xc1\n")
            for name in after:
                f.write(good_line(name) + b"\n")

        shares = list(psa.iter_shares(self.tmpdir))
        usernames = [s["username"] for s in shares]
        self.assertEqual(len(usernames), 100)
        self.assertEqual(usernames, before + after)

    def test_multiple_bad_lines_interspersed_do_not_drop_good_lines(self):
        path = os.path.join(self.tmpdir, "bad_encoding_multi.sharelog")
        with open(path, "wb") as f:
            f.write(good_line("g0") + b"\n")
            f.write(b"\xff bad1 \x80\n")
            f.write(good_line("g1") + b"\n")
            f.write(b"\xfe bad2 \x81\n")
            f.write(good_line("g2") + b"\n")
            f.write(b"\xc0\xc1 bad3\n")
            f.write(good_line("g3") + b"\n")

        shares = list(psa.iter_shares(self.tmpdir))
        usernames = [s["username"] for s in shares]
        self.assertEqual(usernames, ["g0", "g1", "g2", "g3"])

    def test_bad_byte_at_start_of_line(self):
        path = os.path.join(self.tmpdir, "bad_at_start.sharelog")
        with open(path, "wb") as f:
            f.write(good_line("before") + b"\n")
            f.write(b"\xff" + good_line("would_be_good")[1:] + b"\n")
            f.write(good_line("after") + b"\n")
        shares = list(psa.iter_shares(self.tmpdir))
        usernames = [s["username"] for s in shares]
        self.assertEqual(usernames, ["before", "after"])

    def test_bad_byte_at_end_of_line_before_newline(self):
        path = os.path.join(self.tmpdir, "bad_at_end.sharelog")
        with open(path, "wb") as f:
            f.write(good_line("before") + b"\n")
            f.write(good_line("would_be_good")[:-1] + b"\xff\x80\n")
            f.write(good_line("after") + b"\n")
        shares = list(psa.iter_shares(self.tmpdir))
        usernames = [s["username"] for s in shares]
        self.assertEqual(usernames, ["before", "after"])

    def test_bad_byte_in_middle_of_line(self):
        path = os.path.join(self.tmpdir, "bad_in_middle.sharelog")
        line = good_line("would_be_good")
        mid = len(line) // 2
        corrupted = line[:mid] + b"\xff\x80\xfe" + line[mid:]
        with open(path, "wb") as f:
            f.write(good_line("before") + b"\n")
            f.write(corrupted + b"\n")
            f.write(good_line("after") + b"\n")
        shares = list(psa.iter_shares(self.tmpdir))
        usernames = [s["username"] for s in shares]
        self.assertEqual(usernames, ["before", "after"])

    def test_truncated_multibyte_utf8_sequence_at_eof_no_trailing_newline(self):
        """
        A truncated multi-byte UTF-8 sequence (e.g. log file cut off
        mid-write at EOF, no trailing newline) should be skipped, not
        crash, and should not affect earlier good lines.
        """
        path = os.path.join(self.tmpdir, "truncated_eof.sharelog")
        with open(path, "wb") as f:
            f.write(good_line("before") + b"\n")
            # 0xE2 0x82 is the start of a 3-byte UTF-8 sequence (e.g. for
            # U+20AC) but is truncated here with no final byte and no
            # trailing newline.
            f.write(b'{"username": "trunc", \xe2\x82')
        shares = list(psa.iter_shares(self.tmpdir))
        usernames = [s["username"] for s in shares]
        self.assertEqual(usernames, ["before"])

    def test_valid_multibyte_utf8_in_a_value_is_still_parsed_correctly(self):
        """
        Sanity check that the fix didn't overcorrect: legitimate multi-byte
        UTF-8 content (e.g. a worker/agent name with non-ASCII characters)
        still round-trips correctly.
        """
        path = os.path.join(self.tmpdir, "valid_multibyte.sharelog")
        record = {"username": "u1", "workername": "u1.über-miner",
                   "result": True, "sdiff": 1.0, "createdate": "1700000000,0"}
        with open(path, "wb") as f:
            f.write(json.dumps(record).encode("utf-8") + b"\n")
        shares = list(psa.iter_shares(self.tmpdir))
        self.assertEqual(len(shares), 1)
        self.assertEqual(shares[0]["workername"], "u1.über-miner")


if __name__ == "__main__":
    unittest.main()
