// The guestbook's words, in English and Spanish. Any of them can be replaced with the
// `labels` option. {n} is the number of characters typed, {max} the limit.

export const LABELS = {
  en: {
    region: "Guestbook",
    name: "Name",
    website: "Your site (optional)",
    message: "Message",
    count: "{n}/{max}",
    send: "Sign",
    sending: "Sending…",
    sent: "Thanks! Your message will show up here once it's been read.",
    missing: "Write your name and a message.",
    waitCheck: "Wait a moment for the check below to finish.",
    checkFailed: "The anti-bot check didn't pass. Try again.",
    tooMany: "That's a lot of messages for one hour. Try again later.",
    failed: "Something went wrong. Try again in a while.",
    messages: "Messages",
    empty: "No messages yet. Be the first!",
    loading: "Loading…",
    unavailable: "The messages can't be loaded right now.",
    soon: "The guestbook opens soon.",
  },
  es: {
    region: "Libro de visitas",
    name: "Nombre",
    website: "Tu sitio (opcional)",
    message: "Mensaje",
    count: "{n}/{max}",
    send: "Firmar",
    sending: "Enviando…",
    sent: "¡Gracias! Tu mensaje aparecerá aquí cuando lo lean.",
    missing: "Escribe tu nombre y un mensaje.",
    waitCheck: "Espera un momento a que termine la verificación de abajo.",
    checkFailed: "La verificación anti-bots no pasó. Inténtalo de nuevo.",
    tooMany: "Son muchos mensajes en una hora. Inténtalo más tarde.",
    failed: "Algo salió mal. Inténtalo en un rato.",
    messages: "Mensajes",
    empty: "Aún no hay mensajes. ¡Sé el primero!",
    loading: "Cargando…",
    unavailable: "Los mensajes no se pueden cargar ahora.",
    soon: "El libro de visitas abre pronto.",
  },
};

export const LANGUAGES = Object.keys(LABELS);

/** Words for a language ("es", "es-CO"…, anything else is English), with overrides on top. */
export function labelsFor(lang, overrides) {
  const base = LABELS[String(lang || "en").slice(0, 2).toLowerCase()] ?? LABELS.en;
  return { ...base, ...(overrides || {}) };
}
