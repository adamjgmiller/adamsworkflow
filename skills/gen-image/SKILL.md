---
name: gen-image
description: Generate or edit images with Google's Gemini image family ("Nano Banana") in one Bash call — bring your own Google key (Vertex or Gemini API). Illustrations for communication pages, docs, walkthroughs (make-it-easy generates its own card images — don't call this inside a make-it-easy run). Text→image, or image(s)+prompt→edited/restyled image. Use whenever a generated illustration would genuinely aid a deliverable; never decoration for its own sake.
---

# gen-image

One Bash call, image out:

```bash
python3 ~/.claude/scripts/gen-image/gen_image.py "<prompt>" -o <path>.png \
    [--model pro|flash|flash-lite|imagen|<full-id>] [--aspect 16:9] \
    [--size 1K|2K|4K] [--ref input.png ...]
```

Runs from any Python — if `google-genai` is missing it re-execs itself through the
shared venv (`mie.py env`, created on first use). **Bring your own key** — one-time
setup, either route:

- **Vertex AI**: set `GOOGLE_CLOUD_PROJECT` to a GCP project with the Vertex AI API
  enabled (plus `GOOGLE_APPLICATION_CREDENTIALS` if you're not on gcloud ADC).
- **Gemini API key**: set `GEMINI_API_KEY` (free tier available via Google AI Studio).

## Models (verified live 2026-07-05)

| Alias | Model | Use |
|---|---|---|
| `pro` (default) | `gemini-3-pro-image` | Best quality, in-image text, instruction-following; up to `--size 4K` |
| `flash` | `gemini-3.1-flash-image` | Faster, several× cheaper; fine for drafts/volume; up to 2K |
| `flash-lite` | `gemini-3.1-flash-lite-image` | Cheapest tier |
| `imagen` | `imagen-4.0-generate-001` | Legacy text→image only (no `--ref`/`--size`); runs at `us-central1` |

Gemini models run at `location="global"`; the script handles the split. Cost is
cents per image — default to `pro` for anything the user will look at, drop to `flash`
when iterating or generating many.

## Editing / reference images

`--ref` (repeatable) attaches input image(s) before the prompt: "restyle this
diagram as a woodcut", "same character, new scene", "match this page's palette".
This is what the Gemini family adds over Imagen — use it for visual consistency
across a page's illustrations (pass image 1 as `--ref` when generating image 2).

## Behavior & gotchas

- Prints `OK <path> <bytes> <mime> model=<model>` on success; `pro` also streams
  its reasoning as `note:` lines on stderr — ignore them, they're not errors.
- No image part in the response (refusal) → nonzero exit with the model's notes.
- No retry logic: on a transient 429/503, just rerun the call.
- Output is PNG regardless of extension (a mismatch warns on stderr) — name files `.png`.
- Aspect ratios: `1:1 2:3 3:2 3:4 4:3 4:5 5:4 9:16 16:9 21:9`. Omit `--aspect`
  and the model picks (or matches the `--ref` input).
- For self-contained single-file HTML (e.g. Artifacts), embed the result as a
  data URI; pages served from a directory reference it relatively.
- make-it-easy generates its card images itself (`media_gen.py`, same model) —
  don't call this script inside a make-it-easy run.
