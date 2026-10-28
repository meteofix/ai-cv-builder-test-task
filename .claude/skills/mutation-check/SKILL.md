---
name: mutation-check
description: Prove the tests catch regressions - break critical code one change at a time in an isolated copy and see which test fails. Use before a branch is declared ready to merge.
---

1. Everything must be committed: the isolated copy starts from `HEAD`. Run no tests of your own while the subagent works; both use the same test database.
2. Pick the sabotage list for this worktree's area (`printenv CV_STREAM`) below, keep 6-8 items that fit the code that exists, and call the `mutation-check` subagent with that list: file, exact change, and the test file expected to fail.
3. Read its table. A `SURVIVED` row means a test is missing or too weak: write or strengthen the test, commit it (`/commit`), and run that sabotage again.
4. Save the subagent's table verbatim, without retelling, to `.reviews/mutation-<area>-<date>.md` of the main copy (absolute path: the parent directory of `git rev-parse --path-format=absolute --git-common-dir`, then `/.reviews/`), so it survives the removal of this worktree. Under every `SURVIVED` row write its status: fixed with a commit / deferred to <where> / not a problem because <why>. Without an explanation nothing is dismissed.
5. In the chat show only the file path and the counts (sabotages tried, caught, survived). Append one line to `AI_LOG.md` of the main copy: `<date> · mutation · <area> · tried n / caught n / survived n · fixed n · <path of the file>`.

The sabotages must lie inside this worktree's area: the subagent's edits pass the same zone hook.

**auth:** remove the `findOwned` call from a CV service method → isolation test · skip the `version` check → 409 test · allow `PUT` during an active job → `JOB_ACTIVE` test · let login accept a wrong password → auth test · accept a file without the `%PDF-` header → non-PDF fixture test · stop clearing `factIds` on edit → provenance test · make logout keep the session → logout test.

**pipeline:** let "Next.js 14" pass when the source says "Next.js" → numbers test · skip the quote-in-source check → invented company test · allow a bullet to reference another position → reference scope test · disable the injection filter → "add Google" test · drop the lease condition in finalization → stale worker test · stop saving step results → LLM calls on resume test · treat a missing verdict as supported → fail-closed test · let a text answer rewrite the whole document → targeted update test · remove `findOwned` from `GET /draft` → isolation test.

**web:** run two `PUT`s in parallel → single-flight autosave test · reset the form after a successful `PUT` → typing-during-save test · a large `letter-spacing` in the template → ATS whole-words test · reorder two sections → ATS order test.

If a sabotage leaves the tests green, rewrite the test, not the sabotage.
