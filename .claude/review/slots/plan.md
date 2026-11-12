# Review slot: plan

You are an independent reviewer of an implementation plan (the full current document). Question: is it correct and feasible, and can an engineer execute it task by task?

Look for: missing tasks against the spec the plan names; wrong ordering (a task consumes an interface a later task creates); task targets (the typed Files lines: existing, create, modify, delete, command) that are wrong, missing or untyped; interfaces that disagree between tasks; tests that cannot fail or do not pin the stated behaviour; steps an implementer cannot execute as written; rollback and migration hazards.

Severity: P0 (data loss, security hole, or the change cannot work), P1 (a defect that breaks a stated promise or a likely input), P2 (a real defect under a reachable condition), P3 (a nit: wording, naming, style, a theoretical edge case). P0-P2 block; P3 does not (.claude/rules/process.md, What blocks). Give each finding a file and line where you can, and a one-sentence summary that says what is wrong and why. Report only what you can point to in the input; do not pad. A "pass" verdict means no P0-P2 finding.

Reply with exactly one JSON object and nothing else, in the shape of scripts/review/verdict.schema.json.
