#!/usr/bin/env python3
"""make-it-easy launcher — the one concurrency-safe entrypoint every agent uses.

Subcommands:
  init  <slug>            mint a UNIQUE run dir, copy the engine, scaffold dirs -> prints run dir
  env                     ensure the shared venv exists (flock-guarded) -> prints venv python
  media <run> [--force]   ensure env, then generate audio/images from <run>/spec.json
  url   <run> [timeout]   wait for the server's chosen free port -> prints http://<host>:<port>
  wait  <run> [timeout]   block until the page is submitted -> prints state.json
  list                    list runs (newest first); pages are kept (no auto-GC)

Isolation (multiple agents at once never collide):
  - unique run dir:  runs/<epoch>-<rand>-<slug>/   (random suffix => no clash even same slug/second)
  - free port:       server binds port 0; real port published to <run>/state/PORT
  - shared venv:     created under an exclusive flock; concurrent reads are safe
Everything for a run (spec, assets, state, SUBMITTED) lives inside its own run dir.
"""
import os, sys, time, secrets, shutil, subprocess, fcntl, re, json

# ~/.claude root (override with CLAUDE_HOME for sandboxed / relocated installs).
CLAUDE_HOME = os.environ.get("CLAUDE_HOME", os.path.expanduser("~/.claude"))
BASE = os.path.join(CLAUDE_HOME, "make-it-easy")          # runtime data: runs/, .venv
RUNS = os.path.join(BASE, "runs")
# mie.py, engine/, and media_gen.py ship together in one folder — derive their
# paths from __file__ so a relocated / sandboxed install finds its own siblings.
SCRIPTS = os.path.dirname(os.path.abspath(__file__))
ENGINE = os.path.join(SCRIPTS, "engine")
MEDIA = os.path.join(SCRIPTS, "media_gen.py")
VENV = os.path.join(BASE, ".venv")
VENV_PY = os.path.join(VENV, "bin", "python")
# The display host for the printed URL is read from the server-published
# state/HOST at url-time (see cmd_url), with MIE_HOST as the env fallback and
# 127.0.0.1 (localhost-only) as the final default. To reach pages from other
# devices, set MIE_HOST to a private tailnet/VPN hostname or IP (see the
# README's serving section) — and set MIE_BIND to match on the server side.


def slugify(s):
    s = re.sub(r"[^a-z0-9]+", "-", (s or "session").lower()).strip("-")
    return (s or "session")[:40]


def cmd_init(slug):
    os.makedirs(RUNS, exist_ok=True)
    rid = f"{int(time.time())}-{secrets.token_hex(3)}-{slugify(slug)}"
    run = os.path.join(RUNS, rid)
    shutil.copytree(ENGINE, run,                       # rid is unique -> dest never pre-exists
                    ignore=shutil.ignore_patterns("*.bak-*", "__pycache__", "*.pyc"))
    for d in ("assets/audio", "assets/diagrams", "assets/img", "state"):
        os.makedirs(os.path.join(run, d), exist_ok=True)
    print(run)


def cmd_env():
    os.makedirs(BASE, exist_ok=True)
    with open(os.path.join(BASE, ".venv.lock"), "w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)               # one creator at a time
        if not os.path.exists(VENV_PY):
            subprocess.check_call([sys.executable, "-m", "venv", VENV])
            subprocess.check_call([VENV_PY, "-m", "pip", "install", "-q", "--upgrade", "pip"])
        if subprocess.run([VENV_PY, "-c", "import google.genai"],
                          capture_output=True).returncode != 0:
            subprocess.check_call([VENV_PY, "-m", "pip", "install", "-q", "google-genai"])
    return VENV_PY


def cmd_media(run, force=False):
    # Keyless path: with no Google credentials, media_gen prints its text-only
    # skip and exits 0 without touching the network. Run it on the SYSTEM python
    # so we never build the venv or pip-install just to skip — the run still
    # succeeds fully offline. media_gen imports google-genai lazily (its import
    # is guarded), so the skip path needs no package installed.
    if not os.environ.get("GOOGLE_CLOUD_PROJECT") and not os.environ.get("GEMINI_API_KEY"):
        subprocess.check_call([sys.executable, MEDIA, os.path.abspath(run)]
                              + (["--force"] if force else []))
        return
    py = cmd_env()
    subprocess.check_call([py, MEDIA, os.path.abspath(run)] + (["--force"] if force else []))


def cmd_url(run, timeout=30):
    pf = os.path.join(run, "state", "PORT")
    hf = os.path.join(run, "state", "HOST")
    t0 = time.time()
    while time.time() - t0 < float(timeout):
        if os.path.exists(pf):
            port = open(pf).read().strip()
            if port:
                # Prefer the display host the server actually published; fall
                # back to the env override, then localhost — so the printed URL
                # matches the host the page is being served on.
                host = open(hf).read().strip() if os.path.exists(hf) else ""
                host = host or os.environ.get("MIE_HOST", "127.0.0.1")
                print(f"http://{host}:{port}")
                return
        time.sleep(0.3)
    sys.exit("timed out waiting for server PORT")


def cmd_wait(run, timeout=86400):
    sent = os.path.join(run, "state", "SUBMITTED")
    sf = os.path.join(run, "state", "state.json")
    t0 = time.time()
    while time.time() - t0 < float(timeout):
        if os.path.exists(sent):
            print(open(sf).read() if os.path.exists(sf) else "{}")
            return
        time.sleep(2)
    sys.exit("WAIT_TIMEOUT")


def cmd_list():
    if not os.path.isdir(RUNS):
        return
    for d in sorted(os.listdir(RUNS), reverse=True):
        run = os.path.join(RUNS, d)
        done = os.path.exists(os.path.join(run, "state", "SUBMITTED"))
        print(f"{'✓' if done else '·'} {d}")


def main():
    a = sys.argv[1:]
    if not a:
        sys.exit(__doc__)
    cmd, rest = a[0], a[1:]
    force = "--force" in rest
    pos = [x for x in rest if not x.startswith("-")]
    if cmd == "init":
        cmd_init(pos[0] if pos else "session")
    elif cmd == "env":
        print(cmd_env())
    elif cmd == "media":
        if not pos:
            sys.exit("mie media: missing run dir\nusage: mie.py media <run> [--force]")
        cmd_media(pos[0], force)
    elif cmd == "url":
        if not pos:
            sys.exit("mie url: missing run dir\nusage: mie.py url <run> [timeout]")
        cmd_url(pos[0], pos[1] if len(pos) > 1 else 30)
    elif cmd == "wait":
        if not pos:
            sys.exit("mie wait: missing run dir\nusage: mie.py wait <run> [timeout]")
        cmd_wait(pos[0], pos[1] if len(pos) > 1 else 86400)
    elif cmd == "list":
        cmd_list()
    else:
        sys.exit(f"unknown command: {cmd}\n{__doc__}")


if __name__ == "__main__":
    main()
