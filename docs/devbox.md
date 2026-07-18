# The devbox

> **DRAFT — 2026-07-17**

This is the chapter people ask me for most. The short version: I stopped
running Claude Code on my laptop and moved it to a Linux box that's always
on. Now every device I own — the Mac, my phone, an iPad — is a thin client
to the same running sessions. I can start a long job at my desk, close the
laptop, and the agents keep going. Later I reattach from the couch or a
train and pick up exactly where I left off, mid-task, nothing lost.

None of the individual pieces here are novel. What I haven't seen written
down as one integrated stack is all of it working together — including the
statusline layer, which none of the guides I've read cover. That's what
this chapter is.

## Why a devbox

A laptop is a bad host for long-running agents. It sleeps when you close
it. It drops off WiFi when you walk to another room. Its battery is a
clock counting down against your session. If a build or a review fan-out
takes twenty minutes, you're tethered to the desk for twenty minutes.

Move the work to a machine that never sleeps and those problems disappear.
The agents don't care that your laptop is shut — they're not running on
your laptop. Your devices become windows onto the work, and you can open
or close any of them without touching what's running.

The nice second-order effect: because the box is always reachable and
always on, "kick something off from my phone" becomes real. I've started
real work from a phone while away from my desk more times than I expected
to.

## The stack

Bottom to top, each layer earns its place:

```
  ┌──────────────────────────────────────────────────────────┐
  │  Claude Code   — one session per project / worktree,      │  survives
  │                  each in its own tmux window              │  every
  ├──────────────────────────────────────────────────────────┤  disconnect
  │  tmux          — the persistence layer: windows, panes,   │
  │                  reattach from any client, many at once   │
  ├──────────────────────────────────────────────────────────┤
  │  ssh / mosh    — the transport; mosh survives sleep and   │
  │                  network switches on mobile               │
  ├──────────────────────────────────────────────────────────┤
  │  Tailscale     — flat private network; no port-forwarding,│
  │                  no public SSH, works from any network    │
  ├──────────────────────────────────────────────────────────┤
  │  Linux box     — always on. A VPS, or a dedicated server. │
  └──────────────────────────────────────────────────────────┘

     Mac + terminal        iPhone / iPad          Claude Code Remote
     (ssh / mosh)          (Blink → mosh)         (web or app)
            \                    |                       /
             └──────────── all thin clients ────────────┘
                    onto the same running tmux
```

**Linux box, always on.** The foundation is just a machine that doesn't
turn off. Everything else is layered on top of it.

**Tailscale.** This is what makes the box reachable without exposing it.
Tailscale puts all your devices and the box on one flat private network
(a "tailnet"). No port forwarding, no public SSH port for the internet to
scan, no VPN gymnastics. It works the same from home, from a café, from a
phone on cellular. A useful bonus: any dev server or preview page an agent
spins up for you can be bound to the tailnet and reached from any of your
devices, and nobody else's.

**ssh / mosh.** The transport into the box. Plain `ssh` is fine from a
desktop that stays put on one network. On mobile you want
[mosh](https://mosh.org/) instead: it survives your device sleeping and
switching networks (WiFi to cellular and back), and reconnects instantly
instead of hanging on a dead TCP connection. On a phone that roams all
day, that difference is the whole experience.

**tmux.** This is the actual persistence layer — the part that makes
sessions survive. Claude Code runs *inside* tmux, so when your ssh/mosh
connection drops, the process keeps running; tmux just detaches your
client. Reattach later from any device and you're back. tmux also lets
several clients attach to the same session at once, so the view on my
phone and the view on my Mac are the same live session, not two copies.
I keep one tmux window per project (or per worktree).

**Claude Code, inside a tmux window.** With the layers below in place,
Claude Code sessions inherit all of it for free: they run on a machine
that never sleeps, reachable from anywhere, surviving every disconnect.
One window per project keeps things legible — a glance at the window list
is a glance at everything in flight.

## Choosing the box

I'm deliberately not going to name providers or quote prices — those go
stale and depend on where you are. But here's how I'd size it:

- **A simple 2-core VPS** is plenty for a little dev work — one or two
  sessions at a time. This is a fine place to start and cheap to try.
- **8–16 vCPU** if you expect to run 5–10+ sessions at once. Parallel
  agent work is CPU- and memory-hungry in bursts, and the extra headroom
  is what keeps a dozen concurrent sessions from stepping on each other.
- **A full dedicated server** is the best experience I've had: lowest
  latency, effectively unlimited concurrent sessions, and enough room to
  run your own apps and servers on the same box besides the agents. If
  you're going to live in this setup, this is the one to grow into.

Start small. It's easy to move up a tier once you know your own load.

## Access modes

All of these are things I actually use. They're not alternatives so much
as the right tool for wherever I happen to be.

**Mac + terminal → ssh/mosh → tmux.** My daily driver. I use
[Kitty](https://sw.kovidgoyal.net/kitty/), but any terminal you like is
fine — nothing here depends on the terminal. From the desk this is where
I spend most of my time.

**iPhone / iPad → [Blink](https://blink.sh/) → mosh → tmux.** Blink is
iOS-only, and it's the piece that makes mobile genuinely usable rather
than a party trick. Over mosh it reconnects instantly, so glancing at
progress, answering an agent's question, or kicking off a job from a
phone all work. I wouldn't write a thousand lines of code this way, but
that's not what it's for.

**Claude Code Remote (web or desktop app), any device.** This controls
the same session on the devbox through a nicer UI when you want one. The
thing it does that a terminal-over-ssh can't: image upload and download.
If you need to paste a screenshot to an agent or pull an image back out,
this is the path. I prefer the terminal most of the time, but this is the
complement I reach for when the terminal's limits bite.

**VS Code on the Mac via Remote-SSH.** For managing files on the devbox —
browsing the tree, editing config, moving things around — I run VS Code
against the box over Remote-SSH regularly, alongside the terminal. It's
not either/or; the two live side by side.

## Living in it

A couple of habits make the difference between "technically persistent"
and "actually pleasant."

**One window per project or worktree.** The tmux window list becomes your
project list. Naming windows after the project (not `bash`, `bash`,
`bash`) means the status bar tells you what's where at a glance.

**Two indicators on the status bar, wired to Claude Code hooks.** This
repo ships tmux config for both:

- **A window activity indicator** — flags a window when its session has
  produced output since you last looked at it.
- **A "Claude is waiting on a question" indicator** — wired to Claude
  Code hooks, so when an agent pauses to ask you something, the window
  marks itself. A glance at the status bar tells you which project needs
  a human, instead of cycling through windows to check.

When you're running several sessions at once across several devices,
those two indicators are what keep it from becoming a guessing game.

## Your statusline

When you live inside a terminal multiplexer across several devices, the
statusline is your instrument panel. It's the one always-visible strip
of screen, so it should carry the things you keep wanting to know.

Segments worth having:

- **Current directory + git branch**, worktree-aware — so you always
  know which checkout you're actually in.
- **Model + effort level** — which model this session is on and at what
  reasoning effort.
- **Context used** — how much of the context window you've burned.
- **Quota / usage remaining** — how much headroom you have left before
  you hit a limit.
- **Anything machine-specific you care about** — host name, a resource
  gauge, whatever your setup makes you want to glance at.

I'm not shipping my statusline script, on purpose. Mine is custom-built
for quirks of my own Blink → mosh → tmux stack — terminal-width detection
that has to cope with multiple clients of different sizes attached to the
same session at once — and it would be more confusing than useful pasted
into a different setup. That kind of thing is exactly what your own Claude
can solve for *your* stack when you hit it.

Which is the better way to get one anyway: Claude Code has built-in
statusline support, so you can just ask it to build yours. Here's a
starting prompt — adjust the segments to taste:

```
Build me a Claude Code statusline. Segments, left to right: current dir
with git branch (worktree-aware), model + reasoning effort, context used,
and remaining usage/quota. Each segment must degrade gracefully — if a
data source is missing, drop that segment rather than erroring. Keep it
fast: it runs on every render, so avoid slow subprocesses and cache what's
expensive. Show me the config and the script.
```

Treat that as a seed, not a spec. The point is that the statusline is
worth investing in when you live in the terminal, and it's cheap to build
because you can hand the fiddly parts to the agent.

## Prior art and credits

The building blocks of this pattern are established folk knowledge, and
several people have published good write-ups of pieces of it. What this
chapter adds is the *integrated* stack — and the statusline layer, which
none of them cover. Credit where it's due; all of these are worth reading:

- [Phone to Mac persistent terminal](https://elliotbonneville.com/phone-to-mac-persistent-terminal/) — Elliot Bonneville
- [iPhone + Tailscale + Termius + tmux](https://petesena.medium.com/how-to-run-claude-code-from-your-iphone-using-tailscale-termius-and-tmux-2e16d0e5f68b) — Pete Sena
- [Android / Termux setup](https://www.skeptrune.com/posts/claude-code-on-mobile-termux-tailscale/)
- [iPad setup](https://danyuchn.github.io/blog/posts/en/ipad-claude-code-setup/)
- [WireGuard + mosh + tmux + ntfy](https://rogs.me/2026/02/claude-code-from-the-beach-my-remote-coding-setup-with-mosh-tmux-and-ntfy/)
- [Claude Code remote development setup](https://duanestorey.com/posts/claude-code-remote-development-setup) — Duane Storey
- [Remote-control guide](https://www.zbuild.io/resources/news/claude-code-remote-control-mobile-terminal-handoff-guide-2026)
- [Multi-client tmux gist](https://gist.github.com/alxpck/d1e86d9a62e3fc5cf6c1ce52d0a02b10)

## What this doesn't cover

Honest limits:

- **Image paste needs the Remote app.** A terminal over ssh/mosh can't
  move images. If your workflow leans on screenshots in and out, plan on
  Claude Code Remote for that part.
- **You own a server now.** Updates, patches, and security are yours to
  keep up with. A box exposed only over Tailscale is a much smaller
  target than a public SSH host, but "always on and reachable" still
  means "your responsibility." Budget a little ongoing attention for it.
- **This is a setup, not a script.** I'm describing an architecture and
  the habits around it, not handing you a one-command installer. The
  tmux indicator config ships in this repo; the rest is standard tools
  (Tailscale, mosh, tmux, your terminal) that you install and wire
  together yourself.
