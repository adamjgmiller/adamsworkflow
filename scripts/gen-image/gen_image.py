#!/usr/bin/env python3
"""Generate or edit an image with the Gemini image family (bring your own key).

  gen_image.py "<prompt>" -o out.png [--model pro|flash|flash-lite|imagen|<id>]
                                     [--aspect 16:9] [--size 1K|2K|4K]
                                     [--ref input.png ...]

Text -> image, or (with --ref) image(s) + prompt -> edited/restyled image.

Credentials (one required):
  - GOOGLE_CLOUD_PROJECT  -> Google Vertex AI (the tested path).
  - GEMINI_API_KEY        -> Gemini Developer API (alternative; model/region
                             availability may differ from Vertex).

Works from any Python: if google-genai is missing it re-execs itself with the
shared venv from make-it-easy's mie.py (created on first use, flock-guarded).
"""
import os, sys

# Credentials gate FIRST — before any dependency bootstrap. A keyless run must
# exit with the documented message without touching the network or pip (no venv
# build, no install), so it works offline and fails fast with a clear reason.
if not os.environ.get("GOOGLE_CLOUD_PROJECT") and not os.environ.get("GEMINI_API_KEY"):
    sys.exit("gen-image: no credentials — set GOOGLE_CLOUD_PROJECT (Vertex) "
             "or GEMINI_API_KEY (Gemini Developer API).")

try:
    from google import genai
    from google.genai import types
except ImportError:
    if os.environ.get("GEN_IMAGE_BOOTSTRAP"):
        sys.exit("gen-image: google-genai missing even in the shared venv")
    import subprocess
    claude_home = os.environ.get("CLAUDE_HOME", os.path.expanduser("~/.claude"))
    mie = os.path.join(claude_home, "scripts", "make-it-easy", "mie.py")
    venv_py = subprocess.check_output(
        [sys.executable, mie, "env"], text=True).strip().splitlines()[-1]
    os.environ["GEN_IMAGE_BOOTSTRAP"] = "1"
    os.execv(venv_py, [venv_py, os.path.abspath(__file__)] + sys.argv[1:])

import argparse

ALIASES = {
    "pro": "gemini-3-pro-image",            # default: best quality + in-image text
    "flash": "gemini-3.1-flash-image",      # faster/cheaper, quality a notch below
    "flash-lite": "gemini-3.1-flash-lite-image",
    "imagen": "imagen-4.0-generate-001",    # legacy path: text->image only
}
MIMES = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
         ".webp": "image/webp"}


def main():
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("prompt")
    p.add_argument("-o", "--out", required=True, help="output image path")
    p.add_argument("--model", default="pro",
                   help="pro | flash | flash-lite | imagen | full model id")
    p.add_argument("--aspect", help="e.g. 1:1, 3:2, 4:3, 16:9, 9:16, 21:9")
    p.add_argument("--size", choices=["1K", "2K", "4K"],
                   help="output resolution (pro: up to 4K; flash: up to 2K)")
    p.add_argument("--ref", action="append", default=[], metavar="IMG",
                   help="input image to edit/restyle/reference (repeatable)")
    a = p.parse_args()

    project = os.environ.get("GOOGLE_CLOUD_PROJECT")
    api_key = os.environ.get("GEMINI_API_KEY")
    if not project and not api_key:
        sys.exit("gen-image: no credentials — set GOOGLE_CLOUD_PROJECT (Vertex) "
                 "or GEMINI_API_KEY (Gemini Developer API).")

    def make_client(location):
        # Vertex (tested) preferred; Gemini Developer API fallback (no location).
        if project:
            return genai.Client(vertexai=True, project=project, location=location)
        return genai.Client(api_key=api_key)

    model = ALIASES.get(a.model, a.model)
    out = os.path.abspath(a.out)
    os.makedirs(os.path.dirname(out) or ".", exist_ok=True)

    if model.startswith("imagen"):
        if a.ref or a.size:
            sys.exit("gen-image: --ref/--size need a Gemini image model, not Imagen.")
        client = make_client("us-central1")
        resp = client.models.generate_images(
            model=model, prompt=a.prompt,
            config=types.GenerateImagesConfig(
                number_of_images=1, aspect_ratio=a.aspect or "16:9"))
        data, mime = resp.generated_images[0].image.image_bytes, "image/png"
    else:
        contents = []
        for ref in a.ref:
            with open(ref, "rb") as f:
                contents.append(types.Part.from_bytes(
                    data=f.read(),
                    mime_type=MIMES.get(os.path.splitext(ref)[1].lower(), "image/png")))
        contents.append(a.prompt)
        cfg = types.GenerateContentConfig(response_modalities=["TEXT", "IMAGE"])
        if a.aspect or a.size:
            cfg.image_config = types.ImageConfig(
                aspect_ratio=a.aspect, image_size=a.size)
        client = make_client("global")
        resp = client.models.generate_content(model=model, contents=contents, config=cfg)
        data = mime = None
        for part in resp.candidates[0].content.parts:
            if part.inline_data and part.inline_data.data and data is None:
                data, mime = part.inline_data.data, part.inline_data.mime_type
            elif getattr(part, "text", None):
                print(f"note: {part.text.strip()}", file=sys.stderr)
        if data is None:
            sys.exit("gen-image: model returned no image part (prompt may have "
                     "been refused — see notes above).")

    want = MIMES.get(os.path.splitext(out)[1].lower())
    if want and mime and want != mime:
        print(f"warning: writing {mime} bytes to {out} (extension suggests {want})",
              file=sys.stderr)
    with open(out, "wb") as f:
        f.write(data)
    print(f"OK {out} {len(data)} bytes {mime} model={model}")


if __name__ == "__main__":
    main()
