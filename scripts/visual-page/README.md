# visual-page — shared scaffold for communication visuals

The starting point for any substantial HTML page built to communicate a result
(reports, deep-dives, walkthroughs, comparisons, proposal pages). Used by the
`visual-builder` agent and the `/visual` command.

## What's here

- `template.html` — a complete, self-contained page skeleton: GitHub-flavored
  palette (light default, dark follows the OS), sticky sidebar ToC on desktop
  that collapses to a sticky top-bar of chips on mobile, scrollspy, an
  expand-all control, and a **component reference section** demonstrating every
  building block (cards, callouts, tags, tables, ASCII + SVG diagrams,
  expandables, two-column grid, `.tbd` markers). Builders copy it, fill it, and
  delete the reference section. No external resources — pages work offline and
  behind any CSP.

## Why it exists

Communication visuals are delegated to a sub-agent so the main loop keeps its
context budget. The scaffold saves each builder the tokens/effort of
re-inventing a design system and keeps pages visually consistent. Builders copy
`template.html` — never edit it in place.

## Serving

Serve the built page as a static file, e.g.:

```
python3 -m http.server <port> --directory <dir>
```

By default `http.server` binds all interfaces; to keep it localhost-only,
add `--bind 127.0.0.1`. To open the page from other devices, opt in
explicitly: bind `0.0.0.0` on a trusted network, or preferably bind a private
tailnet/VPN interface (e.g. Tailscale) and share that hostname/IP. Open it at
`http://<host>:<port>/<page>.html`.
