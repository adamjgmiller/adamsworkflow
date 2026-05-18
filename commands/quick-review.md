---
description: Once-over recent work for bugs and unintended side effects — context-aware
---

Do a thorough review for bugs, unintended side effects, and regressions.

## Pick scope

If you've been making changes in this conversation, review *those* changes — re-read the actual diff, not your recollection.

If you were freshly spawned with no prior edits this session, detect scope from git:

1. `git status --porcelain` non-empty → uncommitted changes.
2. Current branch ahead of `main` (fall back to `master`) → `<merge-base>...HEAD`.
3. Otherwise → the most recent commit (`HEAD`).

If a caller (e.g. `/quick-dual-review`) handed you an explicit scope, use that — don't redetect.

State the scope you picked in one line at the top of your review.

## Lens

Apply the blast-radius lens from CLAUDE.md: every writer, every consumer, parallel code paths, full implementations not just signatures, fix the class not the instance, stale comments and docs.

## Disposition

Report your findings. Do not modify files. Only fix if the user explicitly requests it in the same request (e.g., "run /quick-review then fix what you find before reporting back").
