// Default look. Everything follows the text color and font it sits in; restyle it with
// these CSS variables on the guestbook or any parent (all optional):
//   --lm-ink     filled button, names                          (default: the text color)
//   --lm-muted   dates, the character count                    (default: text color at 62%)
//   --lm-line    borders and the lines between messages        (default: text color at 22%)
//   --lm-accent  focus rings and the bar beside notices        (default: the ink)
//   --lm-on-ink  text on the filled button                     (default: Canvas, the page background)
//   --lm-field   background of the text fields                 (default: transparent)
//   --lm-mono    font for dates and the count                  (default: the system monospace)
//
// The defaults live in var() fallbacks, never as declarations, so values set on a
// parent always win. The button's fill is the ink and its words are painted separately
// (text-fill-color), so the two can never collapse into one color.

const INK = "var(--lm-ink, currentColor)";
const MUTED = "var(--lm-muted, color-mix(in srgb, currentColor 62%, transparent))";
const LINE = "var(--lm-line, color-mix(in srgb, currentColor 22%, transparent))";
const ACCENT = "var(--lm-accent, var(--lm-ink, currentColor))";
const ON_INK = "var(--lm-on-ink, Canvas)";
const FIELD = "var(--lm-field, transparent)";
const MONO = "var(--lm-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace)";

export const CSS = `
.lm{display:grid;grid-template-columns:minmax(0,1fr);gap:1.25rem;min-width:0}
.lm [hidden]{display:none!important}
.lm p{margin:0}
.lm-form{display:grid;grid-template-columns:minmax(0,1fr);gap:.75rem;position:relative}
.lm-form label{display:grid;gap:.25rem}
.lm-form label>span{font-size:.94em;font-weight:600}
.lm-count{font-family:${MONO};font-weight:400;color:${MUTED};font-variant-numeric:tabular-nums}
.lm-form input,.lm-form textarea{box-sizing:border-box;width:100%;font:inherit;color:inherit;background:${FIELD};border:1px solid ${LINE};border-radius:0;padding:.45rem .6rem}
.lm-form textarea{resize:vertical;min-height:7rem}
.lm-form input:focus-visible,.lm-form textarea:focus-visible,.lm-send:focus-visible,.lm a:focus-visible{outline:2px solid ${ACCENT};outline-offset:1px}
.lm-trap{position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden}
.lm-check{display:flex;min-height:65px;line-height:0}
.lm-error,.lm-sent{border-left:2px solid ${ACCENT};padding-left:.75rem}
.lm-send{justify-self:start;font:inherit;font-weight:700;cursor:pointer;padding:.45rem 1rem;border-radius:0;color:inherit;background:${INK};border:1px solid ${INK};-webkit-text-fill-color:${ON_INK}}
.lm-send:disabled{opacity:.6;cursor:progress}
.lm-title{margin:0;font-size:1em;font-weight:700}
.lm-list{display:grid;grid-template-columns:minmax(0,1fr);gap:.75rem}
.lm-entries{margin:0;padding:0;list-style:none;display:grid;grid-template-columns:minmax(0,1fr)}
.lm-entries li{display:grid;gap:.3rem;padding:.9rem 0;border-top:1px dashed ${LINE}}
.lm-entries li:first-child{border-top:0;padding-top:0}
.lm-who{display:flex;flex-wrap:wrap;align-items:baseline;gap:.2rem .75rem;font-weight:700;color:${INK}}
.lm-who a{color:inherit}
.lm-who time{font-family:${MONO};font-size:.94em;font-weight:400;color:${MUTED}}
.lm-msg{white-space:pre-wrap;overflow-wrap:anywhere}
.lm-note{color:${MUTED}}
`;
