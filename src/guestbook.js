// The guestbook itself: a form to sign it and the list of approved messages, talking to
// the worker in worker/. Everything visitors typed is put on the page as text, never as HTML.

import { labelsFor } from "./labels.js";
import { CSS } from "./styles.js";

export const LIMITS = { name: 40, website: 120, message: 600 };

export const SAMPLE = [
  { id: 2, name: "Ana", website: "https://example.com/", message: "Love the site! Greetings from my little corner of the web.", date: "2026-11-01T18:00:00Z" },
  { id: 1, name: "Sam", website: "", message: "Hi from another tiny site :)", date: "2026-10-31T21:00:00Z" },
];

/** A visitor's link, only if it is a real web address (never javascript: and friends). */
export function safeUrl(value) {
  try {
    const u = new URL(String(value || ""));
    return u.protocol === "https:" || u.protocol === "http:" ? u.href : "";
  } catch {
    return "";
  }
}

/** "Nov 1, 2026" / "1 nov 2026". An unreadable date gives "". */
export function formatDate(iso, lang) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const locale = String(lang || "en").toLowerCase().startsWith("es") ? "es" : "en-US";
  return new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(d);
}

/** Which label explains a refusal from the worker. */
export function errorLabel(code) {
  return { "check-failed": "checkFailed", "too-many": "tooMany", missing: "missing" }[code] ?? "failed";
}

// ---- Turnstile, Cloudflare's anti-bot check. Its script loads once, and only when a form is shown.

let turnstileScript = null;
function loadTurnstile() {
  if (globalThis.turnstile) return Promise.resolve(globalThis.turnstile);
  turnstileScript ??= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    s.async = true;
    s.onload = () => (globalThis.turnstile ? resolve(globalThis.turnstile) : reject(new Error("turnstile")));
    s.onerror = () => {
      turnstileScript = null;
      reject(new Error("turnstile"));
    };
    document.head.appendChild(s);
  });
  return turnstileScript;
}

function addStyles(container) {
  const root = container.getRootNode?.() ?? document;
  const home = root.head ?? root; // a document's <head>, or the shadow root itself
  if (home.querySelector?.("style[data-leave-a-mark]")) return;
  const style = document.createElement("style");
  style.setAttribute("data-leave-a-mark", "");
  style.textContent = CSS;
  home.prepend(style);
}

const el = (tag, props = {}, ...children) => {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else node.setAttribute(k, v === true ? "" : v);
  }
  node.append(...children.filter(Boolean));
  return node;
};

const DEFAULTS = { api: "", siteKey: "", lang: null, labels: null, parts: "both", theme: "auto", demo: false, title: true, checkBox: null, onSigned: null };

/**
 * Draws a guestbook inside `container` (an element or a shadow root).
 *
 *   createGuestbook(box, { api: "https://guestbook.you.workers.dev", siteKey: "0x4AAA…" })
 *
 * Returns { update(options), reload(), destroy() }.
 */
export function createGuestbook(container, options = {}) {
  let opts = { ...DEFAULTS, ...options };
  let entries; // undefined: loading · null: couldn't load · []: the messages
  let state = "idle"; // idle · sending · sent
  let error = ""; // a label name
  let token = "";
  let widget = null; // Turnstile's id for its box
  let drawnCheck = ""; // what the current Turnstile box was drawn with
  let alive = true;
  let loads = 0;

  addStyles(container);
  const root = el("div", { class: "lm" });
  container.append(root);

  const api = () => String(opts.api || "").replace(/\/+$/, "");
  const lang = () =>
    opts.lang || (container.host ?? container).closest?.("[lang]")?.getAttribute("lang") || document.documentElement.lang || "en";
  const words = () => labelsFor(lang(), opts.labels);
  const wants = (part) => opts.parts === "both" || opts.parts === part;
  const open = () => opts.demo || Boolean(api() && opts.siteKey); // the form needs both
  const listOpen = () => opts.demo || Boolean(api()); // the messages only need the worker

  // ---- the form (built once, so nothing typed is lost when the words change)

  const f = {
    name: el("input", { name: "name", maxlength: LIMITS.name, autocomplete: "nickname", required: true }),
    website: el("input", { name: "website", maxlength: LIMITS.website, inputmode: "url", autocomplete: "url", placeholder: "https://" }),
    message: el("textarea", { name: "message", maxlength: LIMITS.message, rows: 5, required: true }),
    trap: el("input", { name: "company", tabindex: -1, autocomplete: "off" }),
    nameText: el("span"),
    websiteText: el("span"),
    messageText: el("span"),
    count: el("small", { class: "lm-count" }),
    check: el("div", { class: "lm-check" }),
    error: el("p", { class: "lm-error", role: "alert", hidden: true }),
    send: el("button", { class: "lm-send", type: "submit" }),
  };
  const messageLine = el("span");
  messageLine.append(f.messageText, " ", f.count);
  const form = el(
    "form",
    { class: "lm-form", novalidate: true },
    el("label", {}, f.nameText, f.name),
    el("label", {}, f.websiteText, f.website),
    el("label", {}, messageLine, f.message),
    // a trap: hidden from people, often filled in by bots
    el("label", { class: "lm-trap", "aria-hidden": "true" }, "Company", f.trap),
    f.check,
    f.error,
    f.send,
  );
  const sent = el("p", { class: "lm-sent", role: "status", hidden: true });
  const closed = el("p", { class: "lm-note", hidden: true });

  const list = el("div", { class: "lm-list" });
  const title = el("h2", { class: "lm-title" });
  const note = el("p", { class: "lm-note" });
  const items = el("ol", { class: "lm-entries" });
  list.append(title, note, items);

  root.append(form, sent, closed, list);

  // ---- the anti-bot check

  function dropCheck() {
    if (widget != null) globalThis.turnstile?.remove(widget);
    widget = null;
    drawnCheck = "";
    token = "";
  }

  function drawCheck() {
    const needed = wants("form") && open() && !opts.demo && state !== "sent";
    const wanted = needed ? `${opts.siteKey}|${lang()}|${opts.theme}` : "";
    if (wanted === drawnCheck) return;
    dropCheck();
    drawnCheck = wanted;
    if (!needed) return;
    // inside a shadow root the box is handed in from outside (see element.js), since Turnstile draws in the page itself
    const box = opts.checkBox ?? f.check;
    loadTurnstile()
      .then((ts) => {
        if (!alive || drawnCheck !== wanted) return;
        widget = ts.render(box, {
          sitekey: opts.siteKey,
          theme: opts.theme,
          language: lang().slice(0, 2),
          callback: (tok) => (token = tok),
          "expired-callback": () => (token = ""),
          "error-callback": () => (token = ""),
        });
      })
      .catch(() => {
        if (!alive || drawnCheck !== wanted) return;
        error = "failed";
        render();
      });
  }

  // ---- drawing

  function renderEntries(w) {
    items.textContent = "";
    const shown = wants("entries");
    list.hidden = !shown;
    if (!shown) return;
    title.hidden = !opts.title;
    title.textContent = w.messages;
    const message = !listOpen() ? w.soon : entries === undefined ? w.loading : entries === null ? w.unavailable : entries.length === 0 ? w.empty : "";
    note.hidden = !message;
    note.textContent = message;
    if (message) return;
    for (const e of entries) {
      const link = safeUrl(e.website);
      const who = link
        ? el("a", { href: link, target: "_blank", rel: "nofollow ugc noopener noreferrer", text: e.name })
        : el("b", { text: e.name });
      items.append(
        el(
          "li",
          {},
          el("p", { class: "lm-who" }, who, el("time", { datetime: e.date, text: formatDate(e.date, lang()) })),
          el("p", { class: "lm-msg", text: e.message }),
        ),
      );
    }
  }

  function render() {
    const w = words();
    root.lang = lang();
    root.setAttribute("role", "group");
    root.setAttribute("aria-label", w.region);

    const showForm = wants("form");
    form.hidden = !showForm || !open() || state === "sent";
    sent.hidden = !showForm || state !== "sent";
    // with only the form on show, a guestbook that isn't set up says so here; otherwise the list does
    closed.hidden = !(showForm && !open() && !wants("entries"));
    sent.textContent = w.sent;
    closed.textContent = w.soon;

    f.nameText.textContent = w.name;
    f.websiteText.textContent = w.website;
    f.messageText.textContent = w.message;
    f.count.textContent = w.count.replace("{n}", f.message.value.length).replace("{max}", LIMITS.message);
    f.check.hidden = opts.demo || Boolean(opts.checkBox);
    f.error.hidden = !error;
    f.error.textContent = error ? (w[error] ?? w.failed) : "";
    f.send.disabled = state === "sending";
    f.send.textContent = state === "sending" ? w.sending : w.send;

    renderEntries(w);
    drawCheck();
  }

  // ---- loading and signing

  async function load() {
    if (!wants("entries")) return;
    const turn = ++loads;
    if (opts.demo) entries = SAMPLE;
    else if (!api()) entries = undefined;
    else {
      try {
        const res = await fetch(`${api()}/entries`);
        if (!res.ok) throw new Error(String(res.status));
        const data = await res.json();
        if (turn !== loads) return;
        entries = Array.isArray(data.entries) ? data.entries : [];
      } catch {
        if (turn !== loads) return;
        entries = null;
      }
    }
    if (alive) render();
  }

  // typing again clears the last complaint (and keeps the character count up to date)
  form.addEventListener("input", () => {
    error = "";
    render();
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (state === "sending") return;
    const body = {
      name: f.name.value.trim(),
      website: f.website.value.trim(),
      message: f.message.value.trim(),
      company: f.trap.value,
      token,
    };
    const fail = (label) => {
      state = "idle";
      error = label;
      render();
    };
    if (!body.name || !body.message) return fail("missing");
    const done = () => {
      state = "sent";
      error = "";
      render();
      opts.onSigned?.({ name: body.name, website: body.website, message: body.message });
      (container.host ?? container).dispatchEvent?.(new CustomEvent("signed", { bubbles: true, composed: true }));
    };
    if (opts.demo) return done();
    if (!token) return fail("waitCheck");

    state = "sending";
    error = "";
    render();
    try {
      const res = await fetch(`${api()}/entries`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!alive) return;
      if (res.ok) return done();
      const out = await res.json().catch(() => ({}));
      fail(errorLabel(out.error));
    } catch {
      if (!alive) return;
      fail("failed");
    }
    // each check passes once: ask Turnstile for a fresh one
    if (widget != null) globalThis.turnstile?.reset(widget);
    token = "";
  });

  // page language changes (a language switch) update the words
  const langWatch = typeof MutationObserver !== "undefined" ? new MutationObserver(() => !opts.lang && render()) : null;
  langWatch?.observe(document.documentElement, { attributes: true, attributeFilter: ["lang"] });

  render();
  load();

  return {
    /** Change any option. The messages are fetched again only if where they come from changed. */
    update(next = {}) {
      const before = `${api()}|${opts.demo}|${wants("entries")}`;
      opts = { ...opts, ...next };
      render();
      if (`${api()}|${opts.demo}|${wants("entries")}` !== before) load();
    },
    /** Fetch the messages again. */
    reload: load,
    destroy() {
      alive = false;
      langWatch?.disconnect();
      dropCheck();
      root.remove();
    },
  };
}
