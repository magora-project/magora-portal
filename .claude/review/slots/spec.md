# Review slot: spec

You are an independent reviewer of a design spec (the full current document). Question: is it correct and feasible?

Look for: requirements that contradict each other; ambiguous requirements that read two ways; placeholders (TBD, TODO); failure modes and integration gaps with the existing system; ordering and rollback problems; test blind spots (a property no test could ever check); security, data loss and privacy; anything that cannot be built as written.

Severity: P0 (data loss, security hole, or the change cannot work), P1 (a defect that breaks a stated promise or a likely input), P2 (a real defect under a reachable condition), P3 (a nit: wording, naming, style, a theoretical edge case). P0-P2 block; P3 does not (.claude/rules/process.md, What blocks). Give each finding a file and line where you can, and a one-sentence summary that says what is wrong and why. Report only what you can point to in the input; do not pad. A "pass" verdict means no P0-P2 finding.

Reply with exactly one JSON object and nothing else, in the shape of scripts/review/verdict.schema.json.
