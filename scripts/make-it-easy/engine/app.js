/* make it easy — content-driven walkthrough (the reusable shell) */
(() => {
  "use strict";
  const $ = (s, r = document) => r.querySelector(s);

  const state = { spec: null, cards: [], cursor: 0, answers: {}, tour: false, submitted: false };
  const player = $("#player");
  const stage = $("#stage");
  const rail = $("#rail");

  /* ---------- persistence ---------- */
  let saveTimer = null;
  function flagSaving() {
    const el = $("#saveState"); el.classList.remove("unsaved"); el.classList.add("saving"); $("#saveLabel").textContent = "Saving";
  }
  function flagSaved() {
    const el = $("#saveState"); el.classList.remove("saving", "unsaved"); $("#saveLabel").textContent = "Saved";
  }
  function flagUnsaved() {
    const el = $("#saveState"); el.classList.remove("saving"); el.classList.add("unsaved"); $("#saveLabel").textContent = "Not saved — retrying";
  }
  function flashSavedChip() {
    const chip = $(".saved-chip", stage);
    if (!chip) return;
    chip.classList.add("show");
    clearTimeout(chip._t);
    chip._t = setTimeout(() => chip.classList.remove("show"), 1600);
  }
  async function save(now = false) {
    clearTimeout(saveTimer);
    const doPost = async () => {
      flagSaving();
      // rebuild the body at post time so a retry always sends the latest state
      const body = JSON.stringify({ answers: state.answers, cursor: state.cursor });
      try {
        const r = await fetch("/api/state", { method: "POST", headers: { "Content-Type": "application/json" }, body });
        if (!r.ok) throw new Error("HTTP " + r.status);   // fetch resolves on 5xx — check explicitly
        flagSaved();
        flashSavedChip();
      } catch (e) {
        // persistence failed (offline, or server/disk error): keep local, show it, retry
        flagUnsaved();
        clearTimeout(saveTimer);
        saveTimer = setTimeout(doPost, 3000);
      }
    };
    if (now) return doPost();
    saveTimer = setTimeout(doPost, 500);
  }

  function ans(id) {
    if (!state.answers[id]) state.answers[id] = { choice: null, choices: [], notes: "", discuss: false, confirmed: false };
    return state.answers[id];
  }
  function isAnswered(card) {
    const a = state.answers[card.id]; if (!a) return false;
    return !!(a.choice || (a.choices && a.choices.length) || (a.notes && a.notes.trim()) || a.discuss);
  }
  function isDone(card) {
    const a = state.answers[card.id];
    return !!(a && (a.confirmed || isAnswered(card)));
  }

  /* ---------- rail ---------- */
  function railMeta(card) {
    if (card.kind === "intro") return { kicker: "Start", name: "Welcome" };
    if (card.kind === "outro") return { kicker: "Send", name: "Wrap up" };
    const parts = (card.eyebrow || "").split("·");
    const kicker = (parts[0] || "").replace(/decision/i, "").trim() || "—";
    const name = (parts[1] || card.title || "").trim();
    return { kicker, name };
  }
  function buildRail() {
    rail.innerHTML = "";
    state.cards.forEach((card, i) => {
      const m = railMeta(card);
      const b = document.createElement("button");
      b.className = "rail-item"; b.type = "button"; b.dataset.i = i;
      b.innerHTML = `<span class="rail-node"></span><span class="rail-label"><span class="rail-kicker"></span><span class="rail-name"></span></span>`;
      $(".rail-kicker", b).textContent = m.kicker;
      $(".rail-name", b).textContent = m.name;
      b.addEventListener("click", () => goto(i));
      rail.appendChild(b);
    });
  }
  function syncRail() {
    [...rail.children].forEach((b, i) => {
      const card = state.cards[i];
      b.classList.toggle("active", i === state.cursor);
      b.classList.toggle("done", isDone(card) && i !== state.cursor);
    });
    const total = state.cards.length;
    const done = state.cards.filter(isDone).length;
    $("#progressNum").textContent = `${String(state.cursor + 1).padStart(2, "0")} / ${String(total).padStart(2, "0")}`;
    $("#progressFill").style.width = `${(done / total) * 100}%`;
    document.body.style.setProperty("--lamp-shift", `${state.cursor * 4}px`);
  }

  /* ---------- audio ---------- */
  function audioSrc(card) { return `assets/audio/${card.id}.wav`; }
  let curListenBtn = null;
  function stopAudio() {
    player.pause();
    if (curListenBtn) { curListenBtn.classList.remove("playing", "loading"); setListenLabel(curListenBtn, "Listen"); }
    curListenBtn = null;
  }
  function setListenLabel(btn, t) { const l = btn.querySelector(".listen-label"); if (l) l.textContent = t; }
  function playCard(card, btn, { fromTour = false } = {}) {
    stopAudio();
    curListenBtn = btn;
    btn.classList.add("loading"); setListenLabel(btn, "…");
    player.src = audioSrc(card);
    player.play().then(() => {
      btn.classList.remove("loading"); btn.classList.add("playing"); setListenLabel(btn, fromTour ? "Playing" : "Pause");
    }).catch(() => {
      btn.classList.remove("loading"); setListenLabel(btn, "Listen");
      if (state.tour) endTour();
    });
  }
  player.addEventListener("ended", () => {
    if (curListenBtn) { curListenBtn.classList.remove("playing"); setListenLabel(curListenBtn, "Listen"); }
    if (state.tour) {
      if (state.cursor < state.cards.length - 1) { goto(state.cursor + 1, { autoplay: true }); }
      else endTour();
    }
  });
  function startTour() {
    state.tour = true;
    const t = $("#tourBtn"); t.classList.add("is-on"); t.querySelector(".tour-ico").textContent = "❚❚";
    t.lastChild.textContent = " Stop tour";
    const btn = $(".listen", stage); if (btn) playCard(state.cards[state.cursor], btn, { fromTour: true });
  }
  function endTour() {
    state.tour = false; stopAudio();
    const t = $("#tourBtn"); t.classList.remove("is-on"); t.querySelector(".tour-ico").textContent = "▷";
    t.lastChild.textContent = " Play the tour";
  }

  /* ---------- card render ---------- */
  async function renderCard() {
    const card = state.cards[state.cursor];
    stage.innerHTML = "";
    const node = $("#cardTpl").content.firstElementChild.cloneNode(true);
    node.classList.toggle("intro", card.kind === "intro");
    node.classList.toggle("outro", card.kind === "outro");
    node.hidden = false;

    $(".eyebrow", node).textContent = card.eyebrow || "";
    $(".title", node).textContent = card.title || "";
    $(".dek", node).textContent = card.dek || "";

    // detail (string | {text, code, codeLabel} | array) — curate hard, expand for the heavy content
    if (card.detail) {
      const d = $(".detail", node); d.hidden = false;
      if (card.detailSummary) $("summary", d).textContent = card.detailSummary;
      renderDetail($(".detail-body", node), card.detail);
    }

    // listen
    const listen = $(".listen", node);
    listen.hidden = false;
    listen.addEventListener("click", () => {
      if (curListenBtn === listen && !player.paused) { stopAudio(); }
      else { if (state.tour) endTour(); playCard(card, listen); }
    });

    // visual
    if (card.visual) await mountVisual($(".visual", node), card.visual, card);

    // options
    const a = ans(card.id);
    const optWrap = $(".options", node);
    const kind = card.input && card.input.kind;
    if (!card.input || kind === "none") { optWrap.hidden = true; }
    else {
      (card.input.options || []).forEach((o, idx) => {
        const btn = document.createElement("button");
        btn.className = "opt"; btn.type = "button";
        if (kind === "multi") btn.dataset.multi = "1";
        const selected = kind === "multi" ? a.choices.includes(o.id) : a.choice === o.id;
        if (selected) btn.classList.add("selected");
        btn.innerHTML = `<span class="opt-mark"></span><span class="opt-body"><span class="opt-label"></span><span class="opt-desc"></span></span>`;
        $(".opt-label", btn).textContent = o.label || "";
        if (o.recommended) {
          const t = document.createElement("span"); t.className = "rec-tag"; t.textContent = "Recommended";
          $(".opt-label", btn).appendChild(t);
        }
        $(".opt-desc", btn).textContent = o.desc || "";
        btn.addEventListener("click", () => toggleOption(card, o.id, kind, node));
        optWrap.appendChild(btn);
      });
    }

    // notes — with a live "Saved ✓" confirmation chip
    const notes = $(".notes", node);
    notes.value = a.notes || "";
    if (card.notesPlaceholder) notes.placeholder = card.notesPlaceholder;
    const savedChip = document.createElement("span");
    savedChip.className = "saved-chip"; savedChip.textContent = "Saved ✓";
    $(".notes-label", node).appendChild(savedChip);
    notes.addEventListener("input", () => { a.notes = notes.value; save(); syncRail(); refreshNav(node, card); });

    // discuss escape hatch (decision cards only)
    const discuss = $(".discuss-link", node);
    if (card.kind !== "intro" && card.kind !== "outro") {
      discuss.hidden = false;
      discuss.classList.toggle("is-on", a.discuss);
      discuss.textContent = a.discuss ? "✓ Flagged to talk through live" : "I'd rather talk this one through live →";
      discuss.addEventListener("click", () => {
        a.discuss = !a.discuss;
        discuss.classList.toggle("is-on", a.discuss);
        discuss.textContent = a.discuss ? "✓ Flagged to talk through live" : "I'd rather talk this one through live →";
        save(); syncRail(); refreshNav(node, card);
      });
    }

    // nav
    $(".nav-back", node).disabled = state.cursor === 0;
    $(".nav-back", node).addEventListener("click", () => goto(state.cursor - 1));
    $(".nav-next", node).addEventListener("click", () => onNext(card));
    refreshNav(node, card);

    stage.appendChild(node);
    syncRail();
    node.focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: "smooth" });
    if (state.tour) { const lb = $(".listen", node); playCard(card, lb, { fromTour: true }); }
  }

  async function mountVisual(fig, v, card) {
    fig.hidden = false;
    if (v.type === "svg") {
      try {
        fig.innerHTML = await (await fetch(v.src)).text();   // author-supplied SVG markup
        if (v.alt) { const fc = document.createElement("figcaption"); fc.textContent = v.alt; fig.appendChild(fc); }
      } catch (e) { fig.hidden = true; }
    } else if (v.type === "image") {
      // Mirror media_gen.py's default: a card with no explicit visual.src renders the
      // auto-generated assets/img/<card-id>.png. If the asset is truly absent, hide the
      // figure (onerror) rather than showing a broken image.
      const src = v.src || (card && card.id ? `assets/img/${card.id}.png` : "");
      if (!src) { fig.hidden = true; return; }
      const img = document.createElement("img");
      img.alt = v.alt || ""; img.loading = "lazy";
      img.onerror = () => { fig.hidden = true; };
      img.src = src;
      fig.innerHTML = ""; fig.appendChild(img);
    }
  }

  function renderDetail(container, detail) {
    container.innerHTML = "";
    const blocks = Array.isArray(detail) ? detail : [detail];
    for (const b of blocks) {
      if (typeof b === "string") {
        const p = document.createElement("p"); p.textContent = b; container.appendChild(p);
      } else if (b && typeof b === "object") {
        if (b.text) { const p = document.createElement("p"); p.textContent = b.text; container.appendChild(p); }
        if (b.code) {
          if (b.codeLabel) { const l = document.createElement("div"); l.className = "code-label"; l.textContent = b.codeLabel; container.appendChild(l); }
          const pre = document.createElement("pre"); pre.className = "code-block"; pre.textContent = b.code; container.appendChild(pre);
        }
      }
    }
  }

  function toggleOption(card, optId, kind, node) {
    const a = ans(card.id);
    if (kind === "multi") {
      const i = a.choices.indexOf(optId);
      if (i >= 0) a.choices.splice(i, 1); else a.choices.push(optId);
    } else {
      a.choice = a.choice === optId ? null : optId;
    }
    // re-render option states
    [...$(".options", node).children].forEach((btn, idx) => {
      const o = card.input.options[idx];
      const sel = kind === "multi" ? a.choices.includes(o.id) : a.choice === o.id;
      btn.classList.toggle("selected", sel);
    });
    save(); syncRail(); refreshNav(node, card);
  }

  function isSubmitCard(card) {
    if (card.kind === "outro" || card.submit) return true;
    // safety net: if the spec marked no submit/outro card, the last (non-intro) card submits
    return !state.hasSubmit && card.kind !== "intro" && state.cards.indexOf(card) === state.cards.length - 1;
  }
  function nextLabel(card) {
    if (card.kind === "intro") return card.cta || "Begin";
    if (isSubmitCard(card)) return "Send to Claude";
    return isAnswered(card) ? "Confirm" : "Skip";
  }
  function refreshNav(node, card) {
    const nb = $(".nav-next", node);
    nb.firstChild.textContent = nextLabel(card) + " ";
    nb.classList.toggle("is-send", isSubmitCard(card));
  }

  function onNext(card) {
    ans(card.id).confirmed = true;
    if (isSubmitCard(card)) return submit();
    save();
    if (state.cursor < state.cards.length - 1) goto(state.cursor + 1);
    else syncRail();
  }

  /* ---------- navigation ---------- */
  function goto(i, { autoplay = false } = {}) {
    if (i < 0 || i >= state.cards.length) return;
    state.cursor = i;
    save();
    renderCard();
  }

  /* ---------- submit ---------- */
  async function submit() {
    // Only show "Sent" after the server confirms it persisted state AND wrote the
    // SUBMITTED sentinel. fetch resolves on HTTP errors, so check r.ok explicitly:
    // a 5xx / unwritable state dir must surface as a retry, not a false success
    // (otherwise no sentinel exists and `mie.py wait` hangs to its 24h timeout).
    try {
      const r = await fetch("/api/complete", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers: state.answers }),
      });
      if (!r.ok) throw new Error("HTTP " + r.status);
    } catch (e) {
      flagUnsaved();
      const nb = $(".nav-next", stage);
      if (nb && nb.firstChild) nb.firstChild.textContent = "Couldn't send — tap to retry ";
      return;   // leave the card in place; the button re-runs submit() on the next tap
    }
    state.submitted = true; endTour();
    stage.innerHTML = `
      <div class="done-screen">
        <div class="seal" aria-hidden="true"></div>
        <h1>Sent to Claude.</h1>
        <p>Your answers are saved and I'm picking them up now. You can close this — or reopen it anytime to revise; it'll still be here.</p>
        <p class="file">state/state.json · ${state.cards.filter(isDone).length} of ${state.cards.length} decided</p>
      </div>`;
    syncRail();
  }

  /* ---------- keyboard ---------- */
  function onKey(e) {
    if (state.submitted) return;
    const ae = document.activeElement;
    const typing = ae && /^(textarea|input)$/i.test(ae.tagName);
    if (typing && e.key !== "Escape") return;
    const card = state.cards[state.cursor];
    if (e.key >= "1" && e.key <= "9" && card.input && card.input.options) {
      const idx = +e.key - 1, o = card.input.options[idx];
      if (o) { toggleOption(card, o.id, card.input.kind, $(".card", stage)); e.preventDefault(); }
    } else if (e.key === "Enter") { onNext(card); e.preventDefault(); }
    else if (e.key === "ArrowLeft") { goto(state.cursor - 1); }
    else if (e.key === "ArrowRight") { goto(state.cursor + 1); }
    else if (e.key.toLowerCase() === "l") { const b = $(".listen", stage); if (b) b.click(); }
    else if (e.key === "Escape") { if (state.tour) endTour(); if (ae) ae.blur(); }
  }

  /* ---------- boot ---------- */
  async function boot() {
    state.spec = await (await fetch("spec.json")).json();
    state.cards = state.spec.cards;
    state.hasSubmit = state.cards.some(c => c.kind === "outro" || c.submit);
    try {
      const saved = await (await fetch("/api/state")).json();
      if (saved && saved.answers) state.answers = saved.answers;
      if (typeof saved.cursor === "number") state.cursor = Math.max(0, Math.min(saved.cursor, state.cards.length - 1));
    } catch (e) {}
    buildRail();
    await renderCard();
    const tb = $("#tourBtn"); tb.hidden = false;
    tb.addEventListener("click", () => (state.tour ? endTour() : startTour()));
    document.addEventListener("keydown", onKey);
    requestAnimationFrame(() => document.body.removeAttribute("data-reveal"));
  }
  boot();
})();
