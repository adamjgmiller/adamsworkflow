# make-it-easy engine

The engine behind the `make-it-easy` skill: turns a batch of decisions or
explanations into a calm, visual, optionally audio-narrated web page whose
answers autosave to disk, so you can answer at your own pace and an agent can
resume from the saved state.

## Pieces

- `mie.py` — the concurrency-safe launcher every agent uses. Subcommands:
  `init <slug>` (mint a unique run dir + copy the engine), `env` (create/return
  the shared venv), `media <run>` (generate audio/images from `spec.json`),
  `url <run>` (print the page URL once the server is up), `wait <run>` (block
  until the page is submitted), `list`.
- `media_gen.py` — generates per-card narration audio (TTS) and, for cards that
  opt in, an illustration image, from the run's `spec.json`.
- `engine/` — the page itself: `server.py` (tiny stdlib server with JSON state
  persistence), `index.html`, `app.js`, `styles.css`. `init` copies this folder
  into each run dir so runs never share mutable state.
- `requirements.txt` — the one dependency, `google-genai` (installed into the
  shared venv by `mie.py env`).

## Credentials (bring your own key)

Media generation uses Google's Gemini models. Set up **one** of these two
routes:

- **Vertex AI** (the tested path): set `GOOGLE_CLOUD_PROJECT` to a GCP project
  with the Vertex AI API enabled, plus ADC or service-account credentials
  (`GOOGLE_APPLICATION_CREDENTIALS`) if you're not on gcloud ADC.
- **Gemini Developer API**: set `GEMINI_API_KEY` (alternative; model and region
  availability may differ from Vertex).

If **neither** is set, media generation is skipped with a notice and the run
still succeeds — the page builds text-only (no audio, no generated images).
SVG diagrams authored as files by the agent are unaffected.

## Serving

`engine/server.py` binds an OS-assigned free port and, **by default, serves on
`127.0.0.1` (localhost-only)**. To open pages from other devices, opt in
explicitly via environment variables:

- `MIE_HOST` — the hostname/IP shown in the printed URL (default `127.0.0.1`).
- `MIE_BIND` — the interface the server binds (default: same as `MIE_HOST`).

To reach a page from another device, bind `0.0.0.0` on a trusted network, or
**preferably** bind a private tailnet/VPN interface (e.g. Tailscale) and use
that hostname/IP:

```bash
# localhost-only (default) — nothing to set
python3 engine/server.py

# reachable over a private tailnet interface (preferred for other devices)
MIE_HOST=<your-tailnet-host-or-ip> python3 engine/server.py

# all interfaces on a trusted network, displaying a chosen host
MIE_BIND=0.0.0.0 MIE_HOST=<your-host> python3 engine/server.py
```

The server prints `URL=http://<host>:<port>` and writes the chosen port to
`state/PORT`; `mie.py url <run>` reads it back using the same `MIE_HOST`.
