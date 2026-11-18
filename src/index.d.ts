export interface Entry {
  id: number;
  name: string;
  /** "" when the visitor left none. */
  website: string;
  message: string;
  /** When it was signed, as an ISO date. */
  date: string;
}

export type Labels = typeof import("./labels.js").LABELS.en;

export interface GuestbookOptions {
  /** Address of your worker, e.g. "https://guestbook.you.workers.dev". */
  api?: string;
  /** Turnstile's site key (the public one). */
  siteKey?: string;
  /** "en" or "es". Default: the page's language, and it follows changes to it. */
  lang?: string | null;
  /** Replace any of the words. */
  labels?: Partial<Labels> | null;
  /** Show the form, the messages, or both. Default "both". */
  parts?: "both" | "form" | "entries";
  /** Colors of the anti-bot check. Default "auto" (follows the visitor's system). */
  theme?: "auto" | "dark" | "light";
  /** Sample messages and a form that only pretends to send. For previews. */
  demo?: boolean;
  /** The "Messages" heading above the list. Default true. */
  title?: boolean;
  /** Called when a visitor's message has been sent. */
  onSigned?: ((message: { name: string; website: string; message: string }) => void) | null;
}

export interface GuestbookController {
  update(options: GuestbookOptions): void;
  reload(): Promise<void>;
  destroy(): void;
}

export declare function createGuestbook(container: HTMLElement | ShadowRoot, options?: GuestbookOptions): GuestbookController;

export declare function safeUrl(value: string): string;
export declare function formatDate(iso: string, lang?: string): string;
export declare function errorLabel(code: string): keyof Labels;
export declare const LIMITS: { name: number; website: number; message: number };
export declare const SAMPLE: Entry[];

export declare const LABELS: { en: Labels; es: Labels };
export declare const LANGUAGES: readonly string[];
export declare function labelsFor(lang?: string | null, overrides?: Partial<Labels> | null): Labels;
export declare const CSS: string;

export declare class LeaveAMarkElement extends HTMLElement {
  reload(): Promise<void> | undefined;
}
export declare function defineLeaveAMark(name?: string): void;

declare global {
  interface HTMLElementTagNameMap {
    "leave-a-mark": LeaveAMarkElement;
  }
}
