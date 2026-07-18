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

HOME = os.path.expanduser("~")
BASE = os.path.join(HOME, ".claude", "make-it-easy")
RUNS = os.path.join(BASE, "runs")
SCRIPTS = os.path.join(HOME, ".claude", "scripts", "make-it-easy")
ENGINE = os.path.join(SCRIPTS, "engine")
MEDIA = os.path.join(SCRIPTS, "media_gen.py")
VENV = os.path.join(BASE, ".venv")
VENV_PY = os.path.join(VENV, "bin", "python")
# Display host for the printed URL. Defaults to localhost-only. To reach pages
# from other devices, set MIE_HOST to a private tailnet/VPN hostname or IP (see
# the README's serving section) — and set MIE_BIND to match on the server side.
HOST = os.environ.get("MIE_HOST", "127.0.0.1")


def slugify(s):
    s = re.sub(r"[^a-z0-9]+", "-", (s or "session").lower()).strip("-")
    return (s or "session")[:40]


def cmd_init(slug):
    os.makedirs(RUNS, exist_ok=True)
    rid = f"{int(time.time())}-{secrets.token_hex(3)}-{slugify(slug)}"
    run = os.path.join(RUNS, rid)
    shutil.copytree(ENGINE, run)                       # rid is unique -> dest never pre-exists
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
    py = cmd_env()
    subprocess.check_call([py, MEDIA, os.path.abspath(run)] + (["--force"] if force else []))


def cmd_url(run, timeout=30):
    pf = os.path.join(run, "state", "PORT")
    t0 = time.time()
    while time.time() - t0 < float(timeout):
        if os.path.exists(pf):
            port = open(pf).read().strip()
            if port:
                print(f"http://{HOST}:{port}")
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
        cmd_media(pos[0], force)
    elif cmd == "url":
        cmd_url(pos[0], pos[1] if len(pos) > 1 else 30)
    elif cmd == "wait":
        cmd_wait(pos[0], pos[1] if len(pos) > 1 else 86400)
    elif cmd == "list":
        cmd_list()
    else:
        sys.exit(f"unknown command: {cmd}\n{__doc__}")


if __name__ == "__main__":
    main()
