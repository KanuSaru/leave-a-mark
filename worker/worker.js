// leave-a-mark: a guestbook on a Cloudflare Worker with a D1 database.
//
//   GET  /entries          approved messages, newest first (public)
//   POST /entries          sign the guestbook (checked by Turnstile, held for approval)
//   GET  /admin            your private page to approve or delete messages (asks for the key once)
//
// Settings (see the README):
//   DB                 the D1 database (wrangler.toml)
//   ALLOWED_ORIGINS    sites allowed to use it, comma-separated (wrangler.toml)
//   SITE_NAME          shown on the admin page and in alerts (wrangler.toml, optional)
//   TURNSTILE_SECRET   Turnstile's secret key              (secret)
//   ADMIN_KEY          a long random password for /admin   (secret)
//   DISCORD_WEBHOOK    alerts in a Discord channel         (secret, optional)
//   RESEND_API_KEY     alerts by email, through Resend     (secret, optional)
//   ALERT_EMAIL        where those emails go               (secret, with RESEND_API_KEY)
//   ALERT_FROM         their sender, default "Guestbook <onboarding@resend.dev>" (optional)

const LIMITS = { name: 40, website: 120, message: 600, perHour: 3 };
const SESSION_DAYS = 30;
const COOKIE = "lm_session";

const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
  });

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

function cors(request, env) {
  const origin = request.headers.get("origin") || "";
  const allowed = String(env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((s) => s.trim().replace(/\/$/, ""))
    .filter(Boolean);
  if (!allowed.includes(origin)) return {};
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type",
    "access-control-max-age": "86400",
    vary: "origin",
  };
}

/** Compares two strings in constant time, so the admin key can't be guessed by timing. */
function sameSecret(a, b) {
  const x = new TextEncoder().encode(String(a ?? ""));
  const y = new TextEncoder().encode(String(b ?? ""));
  if (!x.length || x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

const hex = (bytes) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");

/** A one-way fingerprint of the visitor's IP, only to limit how often one person signs. */
async function fingerprint(ip, salt) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${salt}:${ip}`));
  return hex(bytes).slice(0, 32);
}

function clean(s, max) {
  return String(s ?? "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "") // control characters, keeping line breaks
    .replace(/\r\n?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, max);
}

function cleanWebsite(s) {
  const v = clean(s, LIMITS.website);
  if (!v) return "";
  try {
    const u = new URL(/^https?:\/\//i.test(v) ? v : `https://${v}`);
    return u.protocol === "https:" || u.protocol === "http:" ? u.href : "";
  } catch {
    return "";
  }
}

async function turnstileOk(token, ip, env, fetcher) {
  if (!token || !env.TURNSTILE_SECRET) return false;
  const body = new FormData();
  body.append("secret", env.TURNSTILE_SECRET);
  body.append("response", token);
  if (ip) body.append("remoteip", ip);
  const res = await fetcher("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body });
  const out = await res.json().catch(() => ({}));
  return out.success === true;
}

async function listEntries(env) {
  const { results } = await env.DB.prepare(
    "SELECT id, name, website, message, created_at FROM entries WHERE approved = 1 ORDER BY created_at DESC, id DESC LIMIT 300",
  ).all();
  return results.map((r) => ({ id: r.id, name: r.name, website: r.website || "", message: r.message, date: r.created_at }));
}

// ---------------------------------------------------------------- alerts

/**
 * Tells you a message is waiting: a Discord message, an email, or both, whichever is set up.
 * A failed alert never stops the message from being saved.
 */
async function notify(env, entry, adminUrl, fetcher) {
  const site = env.SITE_NAME || "Guestbook";
  const jobs = [];

  if (env.DISCORD_WEBHOOK) {
    jobs.push(
      fetcher(env.DISCORD_WEBHOOK, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          username: site.slice(0, 80),
          // a message from a stranger must never be able to ping anyone
          allowed_mentions: { parse: [] },
          embeds: [
            {
              title: "New guestbook message",
              url: adminUrl,
              description: entry.message.slice(0, 1500),
              fields: [
                { name: "From", value: entry.name.slice(0, 200), inline: true },
                ...(entry.website ? [{ name: "Website", value: entry.website.slice(0, 200), inline: true }] : []),
              ],
              footer: { text: "Waiting for your approval" },
              timestamp: entry.date,
            },
          ],
        }),
      }).then((r) => (r.ok ? null : Promise.reject(new Error(`Discord answered ${r.status}`)))),
    );
  }

  if (env.RESEND_API_KEY && env.ALERT_EMAIL) {
    jobs.push(
      fetcher("https://api.resend.com/emails", {
        method: "POST",
        headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" },
        body: JSON.stringify({
          from: env.ALERT_FROM || "Guestbook <onboarding@resend.dev>",
          to: [env.ALERT_EMAIL],
          subject: `${site}: new message from ${entry.name}`.slice(0, 150),
          text: [
            `${entry.name} signed your guestbook.`,
            entry.website ? `Website: ${entry.website}` : "",
            "",
            entry.message,
            "",
            `Approve or delete it: ${adminUrl}`,
          ]
            .filter((line, i) => line !== "" || i > 1)
            .join("\n"),
        }),
      }).then((r) => (r.ok ? null : Promise.reject(new Error(`Resend answered ${r.status}`)))),
    );
  }

  for (const result of await Promise.allSettled(jobs)) {
    if (result.status === "rejected") console.error("alert failed:", result.reason?.message || result.reason);
  }
}

async function sign(request, env, ctx, url, fetcher) {
  let data;
  try {
    data = await request.json();
  } catch {
    return json({ ok: false, error: "bad-request" }, 400);
  }
  // a field people never see; bots tend to fill it in
  if (data.company) return json({ ok: true, pending: true }, 202);

  const name = clean(data.name, LIMITS.name);
  const message = clean(data.message, LIMITS.message);
  const website = cleanWebsite(data.website);
  if (!name || !message) return json({ ok: false, error: "missing" }, 400);

  const ip = request.headers.get("cf-connecting-ip") || "";
  if (!(await turnstileOk(data.token, ip, env, fetcher))) return json({ ok: false, error: "check-failed" }, 403);

  const who = await fingerprint(ip, env.ADMIN_KEY || "guestbook");
  const since = new Date(Date.now() - 3600_000).toISOString();
  const recent = await env.DB.prepare("SELECT COUNT(*) AS n FROM entries WHERE ip_hash = ? AND created_at > ?")
    .bind(who, since)
    .first();
  if ((recent?.n ?? 0) >= LIMITS.perHour) return json({ ok: false, error: "too-many" }, 429);

  const date = new Date().toISOString();
  await env.DB.prepare("INSERT INTO entries (name, website, message, created_at, approved, ip_hash) VALUES (?, ?, ?, ?, 0, ?)")
    .bind(name, website, message, date, who)
    .run();

  // the alert goes out after the visitor already has their answer
  const alert = notify(env, { name, website, message, date }, `${url.origin}/admin`, fetcher);
  if (ctx?.waitUntil) ctx.waitUntil(alert);
  else await alert;

  return json({ ok: true, pending: true }, 202);
}

// ---------------------------------------------------------------- admin

// Signing in: you type the key once, and the browser keeps a signed pass for 30 days.
// The key itself is never in an address, so it can't leak through history or screenshots.
async function sessionToken(env, expires) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(env.ADMIN_KEY), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`leave-a-mark session ${expires}`));
  return `${expires}.${hex(sig)}`;
}

async function signedIn(request, env) {
  const m = (request.headers.get("cookie") || "").match(new RegExp(`(?:^|;\\s*)${COOKIE}=(\\d+)\\.([0-9a-f]+)`));
  if (!m) return false;
  const expires = Number(m[1]);
  if (!(expires > Date.now())) return false;
  return sameSecret(`${m[1]}.${m[2]}`, await sessionToken(env, expires));
}

const page = (title, body) =>
  new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>${esc(title)}</title>
<style>
body{margin:0;padding:24px 16px;background:#0d0d0c;color:#e7e2d6;font:16px/1.5 system-ui,sans-serif}
main{max-width:44rem;margin:0 auto}h1{font-size:1.5rem}h2{font-size:1.1rem;margin-top:2rem;color:#918c81}
ul{list-style:none;padding:0;display:grid;gap:.75rem}li{border:1px solid #2b2a26;background:#131312;padding:.8rem 1rem}
.meta{margin:0;color:#918c81;font-size:.875rem;overflow-wrap:anywhere}.msg{margin:.4rem 0 .6rem;white-space:pre-wrap;overflow-wrap:anywhere}
a{color:#e7e2d6}button{font:inherit;padding:.25rem .7rem;margin-right:.4rem;cursor:pointer;background:#e7e2d6;color:#0d0d0c;border:1px solid #e7e2d6}
button.no{background:transparent;color:#e7e2d6;border-color:#2b2a26}.notice{border-left:2px solid #7390ff;padding-left:.75rem}
input[type=password]{font:inherit;padding:.3rem .5rem;color:#e7e2d6;background:#0d0d0c;border:1px solid #918c81;width:min(100%,22rem)}
label{display:grid;gap:.3rem;margin-bottom:.75rem}.top{display:flex;justify-content:space-between;align-items:baseline;gap:1rem;flex-wrap:wrap}
</style></head><body><main>${body}</main></body></html>`,
    {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        "x-frame-options": "DENY",
        // "same-origin", not "no-referrer": with that one, browsers send this page's own forms with no origin, and they would be refused
        "referrer-policy": "same-origin",
      },
    },
  );

function loginPage(env, wrong) {
  const site = env.SITE_NAME || "Guestbook";
  return page(
    `${site} admin`,
    `<h1>${esc(site)}</h1>
${wrong ? '<p class="notice">That key isn\'t right.</p>' : ""}
<form method="post" action="/admin/login">
<label>Admin key <input type="password" name="key" autocomplete="current-password" required autofocus></label>
<button>Sign in</button>
</form>`,
  );
}

function adminPage(env, pending, approved, notice) {
  const site = env.SITE_NAME || "Guestbook";
  const row = (e, actions) => `
    <li>
      <p class="meta"><b>${esc(e.name)}</b>${e.website ? ` · <a href="${esc(e.website)}" rel="nofollow noopener noreferrer" target="_blank">${esc(e.website)}</a>` : ""} · ${esc(e.created_at.slice(0, 16).replace("T", " "))} UTC</p>
      <p class="msg">${esc(e.message)}</p>
      <form method="post"><input type="hidden" name="id" value="${e.id}">${actions}</form>
    </li>`;
  return page(
    `${site} admin`,
    `<div class="top"><h1>${esc(site)}</h1><form method="post" action="/admin/logout"><button class="no">Sign out</button></form></div>
${notice ? `<p class="notice">${esc(notice)}</p>` : ""}
<h2>Waiting for you (${pending.length})</h2>
${pending.length ? `<ul>${pending.map((e) => row(e, `<button formaction="/admin/approve">Approve</button><button class="no" formaction="/admin/delete">Delete</button>`)).join("")}</ul>` : "<p>Nothing new.</p>"}
<h2>On the site (${approved.length})</h2>
${approved.length ? `<ul>${approved.map((e) => row(e, `<button class="no" formaction="/admin/delete">Delete</button>`)).join("")}</ul>` : "<p>None yet.</p>"}`,
  );
}

const cookie = (value, maxAge) => `${COOKIE}=${value}; Path=/admin; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Strict`;

async function admin(request, env, url) {
  if (String(env.ADMIN_KEY || "").length < 16) {
    return page("Guestbook admin", "<h1>Not set up yet</h1><p>Set ADMIN_KEY to a long random password (16 characters or more): <code>npx wrangler secret put ADMIN_KEY</code></p>");
  }
  const isPost = request.method === "POST";
  // forms on this page can only be sent from this page
  if (isPost) {
    const origin = request.headers.get("origin");
    if (origin && origin !== url.origin) return new Response("Not allowed", { status: 403 });
  }

  if (url.pathname === "/admin/login" && isPost) {
    const form = await request.formData();
    if (!sameSecret(form.get("key"), env.ADMIN_KEY)) {
      const res = loginPage(env, true);
      return new Response(res.body, { status: 401, headers: res.headers });
    }
    const expires = Date.now() + SESSION_DAYS * 86400_000;
    return new Response(null, {
      status: 303,
      headers: { location: "/admin", "set-cookie": cookie(await sessionToken(env, expires), SESSION_DAYS * 86400), "cache-control": "no-store" },
    });
  }
  if (url.pathname === "/admin/logout" && isPost) {
    return new Response(null, { status: 303, headers: { location: "/admin", "set-cookie": cookie("", 0), "cache-control": "no-store" } });
  }

  if (!(await signedIn(request, env))) return isPost ? new Response("Sign in first", { status: 401 }) : loginPage(env, false);

  let notice = "";
  if (isPost) {
    const form = await request.formData();
    const id = Number(form.get("id"));
    if (url.pathname === "/admin/approve") {
      await env.DB.prepare("UPDATE entries SET approved = 1 WHERE id = ?").bind(id).run();
      notice = "Approved. It's on the site now.";
    } else if (url.pathname === "/admin/delete") {
      await env.DB.prepare("DELETE FROM entries WHERE id = ?").bind(id).run();
      notice = "Deleted.";
    }
  }
  const all = (approved) =>
    env.DB.prepare(
      "SELECT id, name, website, message, created_at FROM entries WHERE approved = ? ORDER BY created_at DESC, id DESC LIMIT 500",
    )
      .bind(approved)
      .all()
      .then((r) => r.results);
  const [pending, approved] = await Promise.all([all(0), all(1)]);
  return adminPage(env, pending, approved, notice);
}

// ---------------------------------------------------------------- entry point

export default {
  async fetch(request, env, ctx, fetcher = fetch) {
    const url = new URL(request.url);
    const headers = cors(request, env);

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });

    try {
      if (url.pathname === "/entries" && request.method === "GET") {
        return json({ entries: await listEntries(env) }, 200, { ...headers, "cache-control": "public, max-age=60" });
      }
      if (url.pathname === "/entries" && request.method === "POST") {
        if (!headers["access-control-allow-origin"]) return json({ ok: false, error: "origin" }, 403);
        const res = await sign(request, env, ctx, url, fetcher);
        for (const [k, v] of Object.entries(headers)) res.headers.set(k, v);
        return res;
      }
      if (url.pathname === "/admin" || url.pathname.startsWith("/admin/")) return await admin(request, env, url);
    } catch (err) {
      console.error(err);
      return json({ ok: false, error: "server" }, 500, headers);
    }
    return new Response("Not found", { status: 404 });
  },
};
