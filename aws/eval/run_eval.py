#!/usr/bin/env python3
"""Tiny groundedness eval. Hits the Function URL with eval.jsonl and reports pass rate.

  python run_eval.py https://<your>.lambda-url.us-east-1.on.aws/

Each line:
  {"question": "...", "expect": "substring", "mode": "contains"|"refuse"}
- contains: PASS if `expect` (case-insensitive) is in the answer.
- refuse:   PASS if the grounded refusal phrase is in the answer (model didn't invent).
Stdlib only — no pip install.
"""
import json
import sys
import urllib.request
from pathlib import Path

REFUSAL = "not sure off the top of my head"


def ask(url, question):
    req = urllib.request.Request(
        url,
        data=json.dumps({"question": question}).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read()).get("answer", "")


def main():
    if len(sys.argv) != 2:
        sys.exit("usage: python run_eval.py <function_url>")
    url = sys.argv[1]
    cases = [json.loads(l) for l in Path(__file__).with_name("eval.jsonl").read_text().splitlines() if l.strip()]

    passed = 0
    for c in cases:
        ans = ask(url, c["question"])
        expect = REFUSAL if c["mode"] == "refuse" else c["expect"]
        ok = expect.lower() in ans.lower()
        passed += ok
        print(f"[{'PASS' if ok else 'FAIL'}] {c['question']}\n        -> {ans[:120]}")

    rate = passed / len(cases) if cases else 0
    print(f"\nGroundedness: {passed}/{len(cases)} = {rate:.0%}")
    sys.exit(0 if passed == len(cases) else 1)


if __name__ == "__main__":
    main()
