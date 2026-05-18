---
description: Re-ask your pending questions/decisions via AskUserQuestion — one at a time, with options, a recommendation, and previews when useful
---

You just asked the user questions or named decisions to make. Convert each into an `AskUserQuestion` call so they can answer with structured options instead of free text.

## Rules

1. **One question per `AskUserQuestion` call.** Do not batch multiple questions into a single call, even though the tool allows up to 4. Ask, wait, then ask the next — each answer can inform the next question (narrow options, drop moot ones).

2. **Identify the pending questions** from your most recent turn(s) before `/askme` was invoked. If you asked 3 things and proposed 2 decisions, that's 5 calls. If unclear, list pending ones in one short line first ("Pending: A, B, C") then start asking.

3. **Build options from the conversation, not from scratch.** Use the concrete choices you already floated. If you proposed "we could do X, Y, or Z", those are the options — don't invent new ones. If you only floated one direction, add a sensible alternative or two (e.g. "skip", "defer", an opposite tradeoff).

4. **Lead with your recommendation.** Put your recommended option *first* and append ` (Recommended)` to its `label`. The `description` should briefly explain *why* or name the tradeoff — short phrase, not a sentence.

5. **Use `preview` only for visual comparisons.** Set the `preview` field when the options are concrete artifacts the user benefits from seeing side-by-side:
   - ASCII mockups of UI/layout variations
   - Code snippets showing different implementations
   - Config or schema examples
   - Diagram variants

   **Do not** use `preview` for preference or yes/no questions, or anything where `label` + `description` already conveys the choice. Previews only work on single-select questions (not `multiSelect`).

6. **`multiSelect: true`** only when the choices are genuinely independent (e.g. "which checks should we run" — could be any combo). Default to single-select.

7. **`header`** is the chip label — ≤12 chars, noun-y ("Auth method", "DB driver", "Layout"). Not a verb phrase.

8. **Don't add an "Other" option** — the harness adds one automatically.

9. **Don't ask `/askme`-style meta questions** ("Should I proceed?", "Is this ready?"). Only convert the actual decision questions.

## Phrasing

- Question text: complete sentence, ends with `?`. Mirror how you originally asked it, but tightened.
- Option `label`: 1–5 words, the choice itself.
- Option `description`: the *consequence* or *tradeoff* of picking it, not a restatement of the label.

## After answers

Once all pending questions are answered, proceed using their answers. Don't re-summarize — just act on them.
