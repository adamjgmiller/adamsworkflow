#!/usr/bin/env python3
"""Generate media for one make-it-easy run from its spec.json.

  python media_gen.py <run_dir> [--force]

For every card:
  - narration text            -> <run>/assets/audio/<id>.wav   (TTS, warm voice)
  - visual {type:"image",      -> <run>/<src>                   (Gemini image model, ONLY when
            prompt, src}                                          a card opts in with a prompt)

Diagrams (visual.type == "svg") are authored as files by the executor agent and need
no generation here. Idempotent: existing files are skipped unless --force.

Credentials (bring your own key):
  - GOOGLE_CLOUD_PROJECT  -> Google Vertex AI (the tested path).
  - GEMINI_API_KEY        -> Gemini Developer API (alternative; model/region
                             availability may differ from Vertex).
  - neither set           -> audio/image generation is skipped with a notice and
                             the run still succeeds; the page builds text-only.
"""
import os, sys, json, wave
from concurrent.futures import ThreadPoolExecutor, as_completed

# Imported lazily so the "no credentials -> skip" path works even when the
# google-genai package is not installed. Only the generation paths need it.
try:
    from google import genai
    from google.genai import types
    _IMPORT_ERR = None
except Exception as e:                    # pragma: no cover - import environment
    genai = types = None
    _IMPORT_ERR = e

ARGS = [a for a in sys.argv[1:] if not a.startswith("-")]
FORCE = "--force" in sys.argv
RUN = os.path.abspath(ARGS[0]) if ARGS else os.getcwd()
PROJECT = os.environ.get("GOOGLE_CLOUD_PROJECT")
API_KEY = os.environ.get("GEMINI_API_KEY")


def _client(location):
    """genai.Client for whichever auth is configured (Vertex preferred).

    Vertex (GOOGLE_CLOUD_PROJECT) is the tested path; GEMINI_API_KEY uses the
    Gemini Developer API, where `location` does not apply. Callers only reach
    this once main() has confirmed one of the two is set and the import worked.
    """
    if PROJECT:
        return genai.Client(vertexai=True, project=PROJECT, location=location)
    return genai.Client(api_key=API_KEY)


VOICE_DEFAULT = "Sulafat"                 # "Warm"
TTS_MODEL = "gemini-2.5-flash-preview-tts"
TTS_LOC = "global"
IMG_MODEL = "gemini-3-pro-image"
IMG_LOC = "global"
STYLE = ("Say this warmly and calmly, like a thoughtful concierge winding down at the "
         "end of a long day — unhurried, gentle, reassuring: ")


def save_wav(path, pcm, rate=24000):
    with wave.open(path, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(rate); w.writeframes(pcm)


def gen_audio(card, voice):
    cid, text = card["id"], card.get("narration")
    if not text:
        return cid, "audio: none"
    out = os.path.join(RUN, "assets", "audio", f"{cid}.wav")
    if os.path.exists(out) and not FORCE:
        return cid, "audio: skip"
    client = _client(TTS_LOC)
    resp = client.models.generate_content(
        model=TTS_MODEL, contents=STYLE + text,
        config=types.GenerateContentConfig(
            response_modalities=["AUDIO"],
            speech_config=types.SpeechConfig(
                voice_config=types.VoiceConfig(
                    prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name=voice)
                )
            ),
        ),
    )
    save_wav(out, resp.candidates[0].content.parts[0].inline_data.data)
    return cid, "audio: ok"


def gen_image(card):
    v = card.get("visual") or {}
    if v.get("type") != "image" or not v.get("prompt"):
        return None
    src = v.get("src") or f"assets/img/{card['id']}.png"
    out = os.path.join(RUN, src)
    if os.path.exists(out) and not FORCE:
        return f"{card['id']} image: skip"
    os.makedirs(os.path.dirname(out), exist_ok=True)
    client = _client(IMG_LOC)
    resp = client.models.generate_content(
        model=IMG_MODEL, contents=v["prompt"],
        config=types.GenerateContentConfig(
            response_modalities=["TEXT", "IMAGE"],
            image_config=types.ImageConfig(aspect_ratio=v.get("aspect", "16:9")),
        ),
    )
    data = next((p.inline_data.data for p in resp.candidates[0].content.parts
                 if p.inline_data and p.inline_data.data), None)
    if data is None:
        raise RuntimeError("no image part in response")
    with open(out, "wb") as f:
        f.write(data)
    return f"{card['id']} image: ok"


def main():
    if not PROJECT and not API_KEY:
        # Graceful degradation: no key -> skip media, page still builds text-only.
        print("media_gen: no Google credentials set (GOOGLE_CLOUD_PROJECT for "
              "Vertex, or GEMINI_API_KEY for the Gemini API) — skipping "
              "audio/image generation. The page will still build (text-only).")
        return
    if _IMPORT_ERR is not None:
        sys.exit(f"media_gen: google-genai is required to generate media but "
                 f"could not be imported ({_IMPORT_ERR}). Install it "
                 f"(pip install google-genai) or unset credentials to skip media.")
    if not os.path.isfile(os.path.join(RUN, "spec.json")):
        sys.exit(f"media_gen: no spec.json in run dir: {RUN}")
    spec = json.load(open(os.path.join(RUN, "spec.json")))
    cards = spec.get("cards", [])
    voice = spec.get("voice", VOICE_DEFAULT)
    os.makedirs(os.path.join(RUN, "assets", "audio"), exist_ok=True)

    failures = 0
    with ThreadPoolExecutor(max_workers=4) as ex:
        futs = {ex.submit(gen_audio, c, voice): c["id"] for c in cards}
        for fut in as_completed(futs):
            cid = futs[fut]
            try:                              # one bad card must not sink the whole batch
                cid, status = fut.result()
                print(f"  {cid:14s} {status}")
            except Exception as e:
                failures += 1
                print(f"  {cid:14s} audio: FAILED {str(e).splitlines()[0][:120]}")

    for c in cards:                          # images: rare / appropriate-only, run sequentially
        try:
            msg = gen_image(c)
            if msg:
                print(f"  {msg}")
        except Exception as e:
            failures += 1
            print(f"  {c['id']:14s} image: FAILED {str(e).splitlines()[0][:120]}")
    print(f"media done ({failures} failed)." if failures else "media done.")


if __name__ == "__main__":
    main()
