// Runs the worker against an in-memory database, with Turnstile, Discord and Resend faked.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import worker from "../worker/worker.js";

function setup(extra = {}) {
  const sql = new DatabaseSync(":memory:");
  sql.exec(fs.readFileSync(new URL("../worker/schema.sql", import.meta.url), "utf8"));
  // the small part of Cloudflare D1's API the worker uses
  const DB = {
    prepare(q) {
      let args = [];
      const st = {
        bind: (...a) => ((args = a), st),
        all: async () => ({ results: sql.prepare(q).all(...args) }),
        first: async () => sql.prepare(q).get(...args) ?? null,
        run: async () => sql.prepare(q).run(...args),
      };
      return st;
    },
  };
  const env = { DB, ALLOWED_ORIGINS: "https://my.site/", TURNSTILE_SECRET: "s", ADMIN_KEY: "k".repeat(32), SITE_NAME: "Test book", ...extra };
  const sent = []; // every outside request the worker makes, except Turnstile
  const outside = async (url, init) => {
    if (String(url).includes("turnstile")) return new Response(JSON.stringify({ success: init.body.get("response") === "good-token" }));
    sent.push({ url: String(url), headers: init.headers, body: JSON.parse(init.body) });
    return new Response("{}", { status: String(url).includes("fail") ? 500 : 200 });
  };
  const site = "https://my.site";
  const call = (path, init = {}) => worker.fetch(new Request(`https://gb.example${path}`, init), env, {}, outside);
  const sign = (body, ip = "1.2.3.4") =>
    call("/entries", { method: "POST", headers: { origin: site, "content-type": "application/json", "cf-connecting-ip": ip }, body: JSON.stringify(body) });
  const login = async () => {
    const form = new FormData();
    form.append("key", env.ADMIN_KEY);
    const r = await call("/admin/login", { method: "POST", body: form, headers: { origin: "https://gb.example" } });
    return r.headers.get("set-cookie").split(";")[0];
  };
  return { env, sent, site, call, sign, login };
}

test("signing: held for approval, checked, limited", async () => {
  const { call, sign, site } = setup();
  let r = await sign({ name: "Ana", message: "Hola!", token: "good-token", website: "ana.neocities.org" });
  assert.equal(r.status, 202);
  assert.equal(r.headers.get("access-control-allow-origin"), site);
  assert.equal((await (await call("/entries")).json()).entries.length, 0, "held until approved");

  assert.equal((await sign({ name: "Bot", message: "spam", token: "bad" })).status, 403, "Turnstile failure is refused");
  assert.equal((await sign({ name: "Bot", message: "spam", token: "good-token", company: "x" })).status, 202, "trap field pretends to work");
  r = await call("/entries", { method: "POST", headers: { origin: "https://evil.example" }, body: "{}" });
  assert.equal(r.status, 403, "other sites can't post");
  assert.equal((await sign({ name: "", message: "x", token: "good-token" })).status, 400, "name required");

  for (let i = 0; i < 2; i++) await sign({ name: "Ana", message: `again ${i}`, token: "good-token" });
  assert.equal((await sign({ name: "Ana", message: "fourth", token: "good-token" })).status, 429, "3 per hour per person");
});

test("admin: the key is typed once, never in the address", async () => {
  const { env, call, sign, login } = setup();
  await sign({ name: "Ana", message: "Hola!", token: "good-token", website: "ana.neocities.org" });
  await sign({ name: "<b>x</b>", message: "<script>alert(1)</script>", token: "good-token" }, "5.6.7.8");

  let page = await (await call("/admin")).text();
  assert.match(page, /Admin key/);
  assert.doesNotMatch(page, /Hola/);
  // the old way in, a key in the address, no longer opens anything
  page = await (await call(`/admin?key=${env.ADMIN_KEY}`)).text();
  assert.doesNotMatch(page, /Hola/);

  const wrong = new FormData();
  wrong.append("key", "nope");
  assert.equal((await call("/admin/login", { method: "POST", body: wrong })).status, 401);

  const cookie = await login();
  assert.match(cookie, /^lm_session=\d+\.[0-9a-f]{64}$/);
  page = await (await call("/admin", { headers: { cookie } })).text();
  assert.match(page, /Waiting for you \(2\)/);
  assert.doesNotMatch(page, /<script>alert/, "messages are escaped");
  assert.doesNotMatch(page, new RegExp(env.ADMIN_KEY), "the key is never on the page");

  // a forged or expired pass is refused
  assert.match(await (await call("/admin", { headers: { cookie: cookie.replace(/.$/, "0") + "0" } })).text(), /Admin key/);
  assert.match(await (await call("/admin", { headers: { cookie: `lm_session=${Date.now() - 1000}.${"a".repeat(64)}` } })).text(), /Admin key/);

  const form = new FormData();
  form.append("id", "1");
  assert.equal((await call("/admin/approve", { method: "POST", body: form })).status, 401, "not without signing in");
  assert.equal((await call("/admin/approve", { method: "POST", body: form, headers: { cookie, origin: "https://evil.example" } })).status, 403, "not from another site");
  page = await (await call("/admin/approve", { method: "POST", body: form, headers: { cookie, origin: "https://gb.example" } })).text();
  assert.match(page, /Approved/);
  const list = (await (await call("/entries")).json()).entries;
  assert.equal(list.length, 1);
  assert.equal(list[0].website, "https://ana.neocities.org/");

  const del = new FormData();
  del.append("id", "2");
  page = await (await call("/admin/delete", { method: "POST", body: del, headers: { cookie } })).text();
  assert.match(page, /Waiting for you \(0\)/);
});

test("admin stays shut until a real key is set", async () => {
  const { call } = setup({ ADMIN_KEY: "short" });
  assert.match(await (await call("/admin")).text(), /Not set up yet/);
});

test("alerts: Discord and email, without the key and without pings", async () => {
  const { sent, sign, env } = setup({ DISCORD_WEBHOOK: "https://discord.example/hook", RESEND_API_KEY: "re_x", ALERT_EMAIL: "me@my.site" });
  const r = await sign({ name: "Ana", message: "Hi @everyone, nice site", token: "good-token", website: "ana.neocities.org" });
  assert.equal(r.status, 202);
  assert.equal(sent.length, 2);
  const discord = sent.find((s) => s.url.includes("discord"));
  assert.deepEqual(discord.body.allowed_mentions, { parse: [] });
  assert.equal(discord.body.embeds[0].url, "https://gb.example/admin");
  assert.match(discord.body.embeds[0].description, /nice site/);
  const mail = sent.find((s) => s.url.includes("resend"));
  assert.equal(mail.headers.authorization, "Bearer re_x");
  assert.deepEqual(mail.body.to, ["me@my.site"]);
  assert.match(mail.body.subject, /Test book: new message from Ana/);
  assert.match(mail.body.text, /Approve or delete it: https:\/\/gb\.example\/admin/);
  assert.doesNotMatch(JSON.stringify(sent), new RegExp(env.ADMIN_KEY));
});

test("no alerts for spam, and a failing alert doesn't lose the message", async () => {
  const quiet = setup({ DISCORD_WEBHOOK: "https://discord.example/hook" });
  await quiet.sign({ name: "Bot", message: "spam", token: "bad" });
  await quiet.sign({ name: "Bot", message: "spam", token: "good-token", company: "x" });
  assert.equal(quiet.sent.length, 0);

  const broken = setup({ DISCORD_WEBHOOK: "https://discord.example/fail" });
  const r = await broken.sign({ name: "Ana", message: "still saved", token: "good-token" });
  assert.equal(r.status, 202);
  const cookie = await broken.login();
  assert.match(await (await broken.call("/admin", { headers: { cookie } })).text(), /still saved/);
});
