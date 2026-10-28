---
name: commit
description: Commit the finished task - lint, typecheck, tests of the changed packages, zone check, reviewer, then one Conventional Commit with a Task trailer. Use at the end of every task.
---

Commit the current work as one commit. Do the steps in order and stop at the first failure.

1. **Task id.** Take it from the context of this session (`W0.1`, `1.2`, `2.4` ...). If unsure, read the "Progress" table at the top of `PLAN.local.md` in the main copy (the parent directory of `git rev-parse --path-format=absolute --git-common-dir`) and pick the task in progress. If it is still unclear, ask the user.
2. **Stage explicitly.** `git add <paths>` for the files of this task only; never `git add -A`. Check `git status --short` for stray files.
3. **Checks**, each must pass:
   - `pnpm lint`
   - `pnpm typecheck`
   - the tests of every package with staged changes: `pnpm --filter <package> test` (root tooling: `pnpm test:tooling`);
   - `pnpm zone:check --staged` — a file outside this worktree's area stops the commit. Revert it or ask the user ("When to ask a human" in `AGENTS.md`).
4. **Review.** Run the `reviewer` subagent with the output of `git diff --cached` pasted into its prompt (for a diff too large to paste: the file list in risk order; it reads the files). Then:
   - Save its reply verbatim, without retelling, to `.reviews/review-<task id>-<date>.md` of the main copy (absolute path: the parent directory of `git rev-parse --path-format=absolute --git-common-dir`, then `/.reviews/`), so it survives the removal of this worktree. A task id list such as `W0.1-W0.3` is fine for a multi-task commit.
   - In the chat show only the file path and the counts per level (BLOCKING / SHOULD-FIX / NITS), never the report.
   - Fix every BLOCKING finding and repeat from step 3. SHOULD-FIX findings are fixed now or in a separate `fix:` commit with the trailer of this task. Disagreeing with a BLOCKING finding is a case for asking a human.
   - Under every BLOCKING and SHOULD-FIX finding in the file write its status: fixed with a test or a commit / deferred to <where> / not a problem because <why>. Without an explanation a finding is not dismissed.
   - Append one line to `AI_LOG.md` of the main copy: `<date> · review-catch · <task id> · BLOCKING a / SHOULD-FIX b / NITS c · fixed n · <path of the file>`.
5. **Commit.** English Conventional Commit: `type(scope): subject`, imperative, at most 72 characters, a short body explaining why. End with trailers, one per line, in one paragraph: `Task: <id>` next to the `Co-Authored-By` line the session's instructions require. Use `git commit -m "<subject>" -m "<body>" --trailer "Task: <id>" --trailer "Co-Authored-By: ..."`; the first commit of the project carries one `Task:` trailer per task it covers. A fix after a review carries the trailer of the task it fixes.
6. Report the commit hash and subject. Do not push.
