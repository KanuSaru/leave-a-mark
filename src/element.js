// <leave-a-mark> custom element.
//
//   <leave-a-mark api="https://guestbook.you.workers.dev" site-key="0x4AAA…"></leave-a-mark>
//
// Attributes: api, site-key, lang, parts ("both", "form" or "entries"), theme ("auto",
// "dark" or "light", for the anti-bot check), demo, no-title, and label-<name> to change
// any of the words, e.g. label-send="Leave your mark".
// It fires a "signed" event when a visitor's message has been sent.

import { createGuestbook } from "./guestbook.js";
import { LABELS } from "./labels.js";

const Base = typeof HTMLElement === "undefined" ? class {} : HTMLElement;
const attr = (k) => `label-${k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
const LABEL_ATTRS = Object.keys(LABELS.en).map(attr);

export class LeaveAMarkElement extends Base {
  static observedAttributes = ["api", "site-key", "lang", "parts", "theme", "demo", "no-title", ...LABEL_ATTRS];

  connectedCallback() {
    if (!this.shadowRoot) {
      const root = this.attachShadow({ mode: "open" });
      // Turnstile draws in the page itself, so its box lives outside the shadow root and shows through this slot
      root.innerHTML = '<style>:host{display:block}::slotted([slot=check]){display:flex;min-height:65px;line-height:0}::slotted([slot=check]:empty){display:none}</style>';
    }
    this.checkBox = document.createElement("div");
    this.checkBox.slot = "check";
    this.append(this.checkBox);
    this.guestbook = createGuestbook(this.shadowRoot, this.#options());
    // the slot sits where the form's own box would be
    const slot = document.createElement("slot");
    slot.name = "check";
    this.shadowRoot.querySelector(".lm-check").after(slot);
  }

  disconnectedCallback() {
    this.guestbook?.destroy();
    this.guestbook = null;
    this.checkBox?.remove();
    this.shadowRoot?.querySelector("slot[name=check]")?.remove();
  }

  attributeChangedCallback() {
    this.guestbook?.update(this.#options());
  }

  /** Fetch the messages again. */
  reload() {
    return this.guestbook?.reload();
  }

  #options() {
    const labels = {};
    for (const k of Object.keys(LABELS.en)) {
      const v = this.getAttribute(attr(k));
      if (v != null) labels[k] = v;
    }
    const parts = this.getAttribute("parts");
    const theme = this.getAttribute("theme");
    return {
      api: this.getAttribute("api") || "",
      siteKey: this.getAttribute("site-key") || "",
      lang: this.getAttribute("lang") || null, // without it, the page's language (and its changes)
      parts: parts === "form" || parts === "entries" ? parts : "both",
      theme: theme === "dark" || theme === "light" ? theme : "auto",
      demo: this.hasAttribute("demo") && this.getAttribute("demo") !== "false",
      title: !this.hasAttribute("no-title"),
      labels,
      checkBox: this.checkBox,
    };
  }
}

/** Register the element (once). */
export function defineLeaveAMark(name = "leave-a-mark") {
  if (typeof customElements !== "undefined" && !customElements.get(name)) {
    customElements.define(name, class extends LeaveAMarkElement {});
  }
}
