---
name: spec-dispute
description: Settle a disagreement between a test and the code, or between a test and its spec, through the spec-judge subagent. Use instead of editing a committed acceptance test or the Acceptance examples section of a spec.
---

1. Write down the dispute in three lines: the spec file and section, the test (file and name) and what it expects, the code (file) and what it does.
2. Call the `spec-judge` subagent with those lines.
3. Act on the verdict:
   - `the test is wrong` / `the code is wrong`: fix that side. A commit that changes a committed `*.acceptance.spec.ts` or an "Acceptance examples" section must name the verdict in its message body: `Spec-judge: <verdict> (<one-line reason>)`.
   - `the spec is ambiguous`: stop. This is a case for asking a human ("When to ask a human" in `AGENTS.md`); bring the two proposed wordings.
4. Save the verdict verbatim, without retelling, to `.reviews/judge-<task id>-<date>.md` of the main copy (absolute path: the parent directory of `git rev-parse --path-format=absolute --git-common-dir`, then `/.reviews/`), with the status under it: what was changed (commit) or why nothing was. In the chat show only the file path and the verdict.
5. Append one line to `AI_LOG.md` of the main copy: `<date> · judge-verdict · <task id> · <spec section>: <verdict> · <path of the file>`.
