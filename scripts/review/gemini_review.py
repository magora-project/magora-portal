#!/usr/bin/env python3
"""Run an adversarial Gemini pass over a diff. Second-vendor review, on demand.

Why this exists
---------------
`docs/runbooks/repo-facts.md` § "Gemini is the second adversarial vendor, not
CodeRabbit" (2026-08-29, David's call) names Gemini as the vendor to reach for
when a second adversarial opinion is required. Until now nothing automated
reaching it: every Gemini finding recorded in that runbook came from a pass run
by hand on David's machine, so a cloud session -- which has no `gemini` CLI --
could not produce one at all.

This script closes that. It needs only `python3`, `curl` and `GEMINI_API_KEY`.

Usage
-----
    git diff origin/dev...HEAD | python3 scripts/review/gemini_review.py "<pr title>"
    ... | python3 scripts/review/gemini_review.py "<title>" --rules AGENTS.md

Exit codes: 0 = the review COMPLETED (findings, or the literal NO FINDINGS),
1 = the review could not be completed, 2 = usage error, 3 = every answer was cut
off before `STOP`, 4 = a complete (`STOP`) answer that is neither NO FINDINGS
nor a finding line -- a refusal, see `classify_verdict`. Every non-zero code
routes `gemini-review.yml` to its `could not run` body, which is a DECLINE.

A transport failure is exit 1, NEVER exit 0 with empty output. "The reviewer
could not run" and "the reviewer found nothing" must not be the same signal --
that is the fail-open shape `.github/workflows/semgrep.yml` deviation 2 exists
to prevent, one vendor over.

Two transport facts, both measured in a Claude Code cloud container
-------------------------------------------------------------------
1. `urllib` DOES NOT WORK HERE. It ignores the session's agent proxy and every
   call dies `RemoteDisconnected`. `curl` reads `HTTPS_PROXY` and works. Do not
   "modernise" this to `requests` or `urllib` without re-testing in that
   environment.

2. Long generations intermittently drop, reaching curl as exit 56 ("failure
   when receiving data from the peer") with NOTHING recorded in the proxy's own
   `recentRelayFailures` -- so the remote is closing it, not the proxy.

   THE CAUSE IS UNESTABLISHED, and a plausible-sounding explanation was wrong.
   Prompt size was the first theory (a long think emits no SSE bytes, so the
   tunnel idles); the data refutes it. Measured over five real PR diffs against
   a 60 KB rules payload:

       12.5 KB diff  OK        20.3 KB diff  FAIL (twice, incl. sequentially)
       25.3 KB diff  FAIL      31.9 KB diff  OK
       33.6 KB diff  OK

   Failures are not monotonic in size: 33.6 KB passed where 20.3 KB failed
   twice. Re-running the two failures with a smaller rules payload made both
   pass -- but that is CONFOUNDED, because a retry at the SAME size was never
   attempted, so "smaller helped" and "retrying helped" are not distinguished.

   Hence `RULES_STEPS`: retry on a dropped stream, shrinking the rules budget
   each time. It is a mitigation that has worked, not a fix for a known cause.
   If you establish the real mechanism, say so here and simplify this.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import tempfile

DEFAULT_MODEL = "gemini-3.1-pro-preview"

# Rules-payload budgets, in bytes, tried in order. See the header: this is a
# measured mitigation for an UNEXPLAINED dropped stream, not a size limit anyone
# has established. The first entry is the full payload; a run that succeeds
# first time never pays for the rest.
RULES_STEPS = (60_000, 18_000, 10_000)

MAX_DIFF_BYTES = 400_000


def diff_size(diff: str) -> int:
    """The diff's size in UTF-8 bytes, the unit the workflow reports (`wc -c`).

    `len(diff)` counts characters, so a multi-byte diff measured under the cap
    while the posted comment called it over (#3790). `surrogateescape` maps
    any undecodable stdin byte back to one byte instead of raising.
    """
    return len(diff.encode("utf-8", "surrogateescape"))


PROMPT_TEMPLATE = """You are an adversarial code reviewer. You are the SECOND vendor on this
diff; another reviewer has already passed it, so restating obvious correctness is
worthless. Your value is finding what a correctness-scoped review structurally cannot.

Review ONLY for: correctness, security, data integrity, and violations of the repo
invariants below. Do NOT flag formatting, naming, import order, or style.

Severity:
  P0 - data loss or corruption, cross-tenant exposure, an auth bypass, a secret
       reaching logs or a client bundle, or a migration that cannot be rolled back.
  P1 - a logic or regression bug reachable in production, a race or ordering bug,
       an unhandled failure path that fails OPEN, or a violation of a repo invariant.
Anything else: leave it out entirely.

Pay particular attention to these classes, which correctness reviews pass over:
  - A LABEL THAT IS A CLAIM: a figure or sentence whose computation is correct but
    whose caption is false for some state it covers. Correct arithmetic is what
    makes a false label invisible.
  - A TEST THAT CANNOT FAIL: an assertion over a collection that never pins the
    collection's size; a negative test asserting only THAT something failed rather
    than WHICH guard fired; a harness supplying the very property the code under
    test is supposed to provide.
  - A COMMENT ASSERTING A TYPE-SAFETY OR EXTERNAL FACT that is not actually true.
  - AN ABSENCE CLAIM ("there is no way to X") widened from one narrow measurement.

For each finding output exactly one line:
  SEVERITY | file:line | one-sentence defect | concrete failure scenario (inputs -> wrong result)

If you find nothing at these severities, output the single line: NO FINDINGS
Do not pad. Do not summarise the diff. Do not praise.

--- PR TITLE ---
{title}

--- REPO INVARIANTS (authoritative) ---
{rules}

--- DIFF ---
{diff}
"""


# 🔴 A NORMAL FINISH IS NOT A VERDICT (#2721). `finishReason=STOP` says the
# model stopped on its own; it says nothing about WHAT it said. "I cannot review
# this request." arrives with `STOP`, was printed with exit 0, and was posted as
# the ordinary `## Gemini review` body -- which `coverage_audit.gemini_verdict`
# reads as GEMINI_COVERED. A vendor decline laundered into coverage.
#
# So a complete answer must also be one of the two shapes PROMPT_TEMPLATE asks
# for: the NO FINDINGS sentinel, or at least one finding line. Anything else is
# a DECLINE, exit 4, routed to the workflow's existing `could not run` body.
#
# 🔴 LENIENT ON PURPOSE, AND IT MUST STAY LENIENT. This is a content predicate
# over free-text model output, and its two failure directions are not equal:
# too loose admits a refusal that happens to start a line with "P1" (rare, and
# still better than today, which admits every refusal); too strict turns a
# GENUINE review into a decline, throwing away real findings behind a red job.
# So a finding line needs only its SEVERITY token at the start -- `P0` or `P1`,
# the only two severities the prompt permits -- after any list/quote/emphasis
# decoration. The ` | file:line | defect | scenario` columns are NOT required:
# a model that writes `**P1** - a.ts:3 ...` has still reviewed. Do not tighten
# this into a full-shape validator without evidence that refusals get through.
NO_FINDINGS = "NO FINDINGS"

# Leading decoration a model plausibly wraps a line in: whitespace, list
# markers, blockquote, emphasis, code ticks, heading hashes, `1.` / `1)`, and a
# markdown-table cell edge `|` (the prompt's pipe-delimited shape is often
# rendered as a table: `| P1 | a.ts:3 | ... |`, #2909 review).
_DECORATION = r"[\s>*_`#|\-\u2022]*(?:\d+[.)]\s*)?[\s*_`|\[(]*"
FINDING_LINE_RE = re.compile(r"^" + _DECORATION + r"P[01]\b", re.IGNORECASE | re.MULTILINE)

VERDICT_NO_FINDINGS = "no_findings"
VERDICT_FINDINGS = "findings"


def classify_verdict(text: str) -> str | None:
    """VERDICT_NO_FINDINGS / VERDICT_FINDINGS, or None for "not a review".

    NO FINDINGS must be the WHOLE answer (case, surrounding whitespace, emphasis
    and a trailing period tolerated): the prompt asks for "the single line", and
    a sentinel buried in prose is exactly what a hedge or refusal would contain.
    A finding is any line OPENING with a P0/P1 severity token -- see the lenient
    rationale above `NO_FINDINGS`.
    """
    # One strip over the whole decoration set, not a chain: a chain stops at
    # the first character it does not own, so "**NO FINDINGS**." kept its
    # right-hand asterisks behind the period (Gemini on #2909).
    bare = text.strip(" \t\r\n*_`.")
    if bare.upper() == NO_FINDINGS:
        return VERDICT_NO_FINDINGS
    if FINDING_LINE_RE.search(text):
        return VERDICT_FINDINGS
    return None


def build_prompt(title: str, rules: str, diff: str) -> str:
    """Assemble the review prompt. Pure, so the tests can pin its shape."""
    return PROMPT_TEMPLATE.format(title=title, rules=rules, diff=diff)


def truncate_rules(rules: str, budget: int) -> str:
    """Trim the rules payload to `budget` bytes, on a line boundary.

    Cutting mid-line can leave a half-written invariant that reads as a complete
    one, which is worse than dropping it: the reviewer would be handed a rule
    whose second clause is missing.
    """
    if budget <= 0 or len(rules) <= budget:
        return rules if budget > 0 else ""
    head = rules[:budget]
    cut = head.rfind("\n")
    return head[:cut] if cut > 0 else head


def parse_sse(stdout: bytes) -> tuple[str, str | None, int | None]:
    """Fold an SSE stream into (text, finish_reason, total_tokens).

    Returns the text accumulated so far even on a truncated stream, so the caller
    can distinguish "nothing arrived" from "arrived and was cut" -- the second is
    reported, never silently treated as an empty review.
    """
    chunks: list[str] = []
    finish: str | None = None
    tokens: int | None = None
    for line in stdout.decode(errors="replace").splitlines():
        if not line.startswith("data: "):
            continue
        payload = line[6:].strip()
        if not payload or payload == "[DONE]":
            continue
        try:
            event = json.loads(payload)
        except json.JSONDecodeError:
            continue
        for candidate in event.get("candidates", []):
            finish = candidate.get("finishReason") or finish
            for part in candidate.get("content", {}).get("parts", []):
                if "text" in part:
                    chunks.append(part["text"])
        usage = event.get("usageMetadata", {})
        tokens = usage.get("totalTokenCount") or tokens
    return "".join(chunks), finish, tokens


def curl_args(model: str, key: str, payload_path: str) -> list[str]:
    """The exact curl invocation. Pure, so a test can pin that the key is not
    placed on the command line in a form that would reach a process listing more
    than necessary, and that the streaming endpoint is the one used."""
    return [
        "curl", "-sS", "--no-buffer", "--max-time", "900",
        "-H", f"x-goog-api-key: {key}",
        "-H", "Content-Type: application/json",
        "--data-binary", f"@{payload_path}",
        "https://generativelanguage.googleapis.com/v1beta/models/"
        f"{model}:streamGenerateContent?alt=sse",
    ]


def run_once(prompt: str, model: str, key: str) -> tuple[str, str | None, int | None]:
    """One attempt. Raises RuntimeError on a transport or API failure."""
    body = json.dumps({
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {"temperature": 0},
    }).encode()

    handle = tempfile.NamedTemporaryFile("wb", suffix=".json", delete=False)
    try:
        handle.write(body)
        handle.close()
        proc = subprocess.run(curl_args(model, key, handle.name), capture_output=True)
    finally:
        os.unlink(handle.name)

    if proc.returncode != 0:
        raise RuntimeError(f"curl exit {proc.returncode}: "
                           f"{proc.stderr.decode(errors='replace')[:300]}")

    text, finish, tokens = parse_sse(proc.stdout)
    # 🔴 `.strip()`, NOT RAW TRUTHINESS. `" \n\t"` is truthy, so a response of
    # nothing but whitespace passed this check, `main` printed `text.strip()`
    # -- empty -- and exited 0. `gemini-review.yml` then posted the ordinary
    # `## Gemini review` body with no verdict in it and completed a GREEN
    # check, and `coverage_audit.py` counts BOTH of those as vendor coverage.
    # An empty review would have been laundered into evidence that the code was
    # reviewed, which is the same defect as the non-STOP one and arrives by a
    # different door. Reproduced with `text=" \n\t"` before fixing: exit 0,
    # stdout a single newline. (Codex, #2708.)
    #
    # RuntimeError rather than a decline, so it re-enters `RULES_STEPS`: an
    # empty answer may be transient, and if every budget gives one the loop
    # ends at exit 1 -- "nothing usable ever answered" -- which is what it is.
    if not text.strip():
        head = proc.stdout[:300].decode(errors="replace")
        raise RuntimeError(f"no text in stream (finish={finish}): {head}")
    return text, finish, tokens


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Adversarial Gemini pass over a diff on stdin.")
    parser.add_argument("title", help="PR title, so the reviewer can judge intent against the diff")
    parser.add_argument("--rules", default="AGENTS.md", help="path to the repo invariants")
    parser.add_argument("--model", default=os.environ.get("GEMINI_MODEL", DEFAULT_MODEL))
    args = parser.parse_args(argv)

    key = os.environ.get("GEMINI_API_KEY")
    if not key:
        print("GEMINI_API_KEY is not set. In a cloud session it comes from the "
              "environment's variables; locally, export it.", file=sys.stderr)
        return 2

    diff = sys.stdin.read()
    if not diff.strip():
        print("empty diff on stdin", file=sys.stderr)
        return 2
    size = diff_size(diff)
    if size > MAX_DIFF_BYTES:
        print(f"diff is {size} bytes, over the {MAX_DIFF_BYTES} cap - review it in parts",
              file=sys.stderr)
        return 2

    rules = ""
    if args.rules and os.path.exists(args.rules):
        with open(args.rules, encoding="utf-8") as fh:
            rules = fh.read()
    elif args.rules:
        print(f"rules file not found: {args.rules} - continuing without repo invariants",
              file=sys.stderr)

    # 🔴 TWO OUTCOMES, TRACKED SEPARATELY -- ONE `last` LIED.
    # A single `last` was overwritten by whichever attempt failed most
    # recently while `incomplete` stayed True, so an incomplete budget
    # followed by a transport error reported "every attempt was
    # incomplete" and quoted a curl error. Both are declines, so coverage
    # was never affected -- what was wrong is the diagnosis an operator
    # reads off a red run, which is the whole reason these codes differ.
    # (Codex, #2708.)
    last_incomplete: str = ""
    last_error: str = ""
    last_unrecognised: str = ""
    incomplete = False
    errored = False
    unrecognised = False
    for budget in RULES_STEPS:
        prompt = build_prompt(args.title, truncate_rules(rules, budget), diff)
        try:
            text, finish, tokens = run_once(prompt, args.model, key)
        except RuntimeError as exc:
            errored = True
            last_error = str(exc)
            print(f"[attempt at rules<={budget} failed: {last_error}]", file=sys.stderr)
            continue
        print(f"\n[model={args.model} rules<={budget} finish={finish} tokens={tokens}]",
              file=sys.stderr)
        if finish != "STOP":
            # 🔴 `!= "STOP"`, NOT `finish and finish != "STOP"`. `None` IS THE
            # COMMON FAILURE, NOT AN EDGE CASE: `parse_sse` returns the text it
            # got with `finish=None` when the stream CLOSES BEFORE emitting a
            # finishReason, and this module's header says a dropped stream is
            # why `RULES_STEPS` exists at all. The truthiness form skipped
            # exactly that case, so a review cut off mid-sentence exited 0 and
            # was posted as an ordinary verdict. The first fix here caught
            # `MAX_TOKENS` and `SAFETY` and left the likeliest one. (Codex,
            # #2708, second round on its own finding.)
            #
            # Measured before narrowing it, because requiring `STOP` would make
            # this vendor permanently red if a successful generation could omit
            # the reason: two real runs against `gemini-3.1-pro-preview` on
            # 2026-09-21, a 130-byte diff and a 23KB diff with the full
            # `AGENTS.md` rules, both reported `finish=STOP`. Two observations,
            # not a proof -- but the failure direction is a LOUD red job, never
            # a silent green, which is decision 4 of `gemini-review.yml`.
            #
            # 🔴 AN INCOMPLETE GENERATION IS NOT A REVIEW, AND MUST NOT EXIT 0.
            # This printed a warning to stderr and returned 0 until 2026-09-21,
            # so `MAX_TOKENS` or `SAFETY` -- the model stopping mid-review, or
            # refusing -- produced the ordinary `## Gemini review` comment and a
            # GREEN `gemini-review` check. Both then read as vendor COVERAGE.
            # That was tolerable while this only informed a human; it is not,
            # now that `coverage_audit.py` counts those two artifacts and
            # `codex_review_guard.py` keeps a required status green on the
            # strength of them. A review that stopped early would have been
            # laundered into evidence that the code was reviewed.
            #
            # Non-zero routes it to the workflow's `## Gemini review could not
            # run` body, which is a DECLINE and never coverage -- the shape that
            # already exists for exactly this meaning. The partial text stays on
            # stdout for the job log rather than being posted as a verdict.
            # (Codex, #2708.)
            #
            # 🔴 IT RETRIES FIRST. `return 3` here skipped the rest of
            # `RULES_STEPS` -- and `finish is None` IS the dropped stream this
            # module's header says the ladder exists for, so the one failure
            # the retries were built to absorb was the one that stopped them.
            # A run that 18 KB or 10 KB would have completed declined at 60 KB.
            # (Codex, #2708, on its own earlier finding.)
            #
            # 🔴 AND THE PARTIAL TEXT GOES TO STDERR. It used to be printed to
            # stdout before this check. Harmless while a decline discarded
            # stdout; with a retry after it, a later complete review would be
            # APPENDED to the cut-off one and the pair posted as a verdict.
            incomplete = True
            why = ("the stream closed before reporting one, so the review was cut off"
                   if finish is None else f"it is {finish}")
            last_incomplete = f"incomplete at rules<={budget}: {why}"
            print(f"[incomplete: finishReason is not STOP -- {why}. Retrying at a "
                  "smaller rules budget if one remains; the partial text follows "
                  "on stderr and is never posted as a verdict.]", file=sys.stderr)
            print(text.strip(), file=sys.stderr)
            continue
        verdict = classify_verdict(text)
        if verdict is None:
            # A complete answer that is not a review (#2721): a refusal, or
            # prose in place of the prescribed shape. Retried like the other
            # declines -- the prompt differs per budget -- and never printed to
            # stdout, which is what the workflow posts as a verdict.
            unrecognised = True
            last_unrecognised = (f"at rules<={budget}: "
                                 f"{text.strip()[:200]!r}")
            print("[no verdict: finishReason is STOP but the answer is neither "
                  f"{NO_FINDINGS} nor a P0/P1 finding line -- a decline, not a "
                  "review. The text follows on stderr and is never posted as a "
                  "verdict.]", file=sys.stderr)
            print(text.strip(), file=sys.stderr)
            continue
        # The workflow keys its clean heading on the EXACT sentinel, so a
        # tolerated variant (`no findings.`, `**NO FINDINGS**`) is normalised
        # here rather than posted under the findings heading.
        print(NO_FINDINGS if verdict == VERDICT_NO_FINDINGS else text.strip())
        return 0

    if unrecognised:
        # At least one attempt answered IN FULL and did not review. That is
        # the most specific diagnosis, so it wins the exit code; the other
        # kinds are still named so an operator is not sent the wrong way.
        extra = ""
        if incomplete:
            extra += f" Also cut off: {last_incomplete}."
        if errored:
            extra += f" Also errored: {last_error}."
        print("no attempt returned a verdict; the model answered but did not "
              f"review. Last unrecognised answer {last_unrecognised}.{extra}",
              file=sys.stderr)
        return 4

    if incomplete:
        # A response arrived and was cut off, at every budget. That is a
        # DECLINE -- `## Gemini review could not run`, never coverage -- and
        # not the same event as a transport that never answered.
        if errored:
            # Mixed. Say so: "every attempt was incomplete" sends an
            # operator to shrink the rules budget, which does nothing for
            # a transport failure.
            print("attempts failed in BOTH ways -- at least one was cut "
                  f"off and at least one errored. Last incomplete: "
                  f"{last_incomplete}. Last error: {last_error}",
                  file=sys.stderr)
        else:
            print(f"every attempt was incomplete; last: {last_incomplete}",
                  file=sys.stderr)
        return 3
    print(f"every attempt failed; last error: {last_error}", file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())
