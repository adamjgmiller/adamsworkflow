# gen-image

One-call image generation and editing with the Gemini image family
("Nano Banana"). Text → image, or reference image(s) + prompt →
edited/restyled image.

## Usage

```
gen_image.py "<prompt>" -o out.png [--model pro|flash|flash-lite|imagen|<id>]
                                   [--aspect 16:9] [--size 1K|2K|4K]
                                   [--ref input.png ...]
```

- `--model` — `pro` (default; best quality + in-image text), `flash`,
  `flash-lite`, `imagen` (legacy text→image only), or a full model id.
- `--ref` — an input image to edit/restyle/reference (repeatable).
- `--aspect` / `--size` — output aspect ratio and resolution (Gemini models;
  not Imagen).

The script re-execs itself into make-it-easy's shared venv if `google-genai`
isn't already importable, so it runs from any Python.

## Credentials (bring your own key)

Set **one** of:

- `GOOGLE_CLOUD_PROJECT` — Google Vertex AI. This is the tested path.
- `GEMINI_API_KEY` — the Gemini Developer API (alternative; model and region
  availability may differ from Vertex).

With neither set, the script exits with a message telling you to set one.
