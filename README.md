# leave-a-mark

A guestbook for personal sites. Visitors leave their name, a link and a message; you read
each one before it shows up; and you get a **Discord message or an email** the moment
someone signs.

It has two halves:

- **The widget**: a small form and the list of messages, for any page. A custom element
  (`<leave-a-mark>`) and a React component, in English and Spanish, with no dependencies.
- **The worker**: a tiny server of your own on Cloudflare's free plan that keeps the
  messages in a database, keeps bots out with Turnstile, and sends you the alerts.

Your site can stay fully static (GitHub Pages, Neocities, Nekoweb, anything).

```html
<leave-a-mark api="https://guestbook.you.workers.dev" site-key="0x4AAA…"></leave-a-mark>
<script src="https://cdn.jsdelivr.net/npm/leave-a-mark@1/dist/leave-a-mark.js"></script>
```

To see it without setting anything up, open `demo/index.html`.

## Set up the worker (once, about 15 minutes)

You need Node 18 or newer and a free Cloudflare account (no credit card).

1. **Get this repo and log in to Cloudflare:**
   ```bash
   git clone https://github.com/KanuSaru/leave-a-mark.git
   cd leave-a-mark/worker
   cp wrangler.example.toml wrangler.toml
   npx wrangler login
   ```
   `wrangler.toml` holds your own settings. Git ignores it, so they stay on your computer.

2. **Create the database.** The first command prints a `database_id`: paste it into `wrangler.toml`.
   ```bash
   npx wrangler d1 create guestbook
   npx wrangler d1 execute guestbook --remote --file=schema.sql
   ```

3. **Say which sites may use it.** In `wrangler.toml`, set `ALLOWED_ORIGINS` to your site's
   address (for `https://you.github.io/home/` that is `https://you.github.io`), and
   `SITE_NAME` to whatever you want alerts to be called.

4. **Create the anti-bot check.** In the Cloudflare dashboard: Turnstile → Add widget. Add your
   site's hostname (and `localhost`), mode **Managed**. You get a **site key** (public, it goes
   on your page) and a **secret key** (private, next step).

5. **Store the two secrets.** Each command asks you to paste the value:
   ```bash
   npx wrangler secret put TURNSTILE_SECRET   # the Turnstile secret key
   npx wrangler secret put ADMIN_KEY          # a long random password: openssl rand -hex 24
   ```
   Keep the ADMIN_KEY in a password manager. It opens your admin page.

6. **Publish it:**
   ```bash
   npx wrangler deploy
   ```
   It prints the worker's address, like `https://guestbook.YOURNAME.workers.dev`.

> Secrets never go in `wrangler.toml`, in your site's code or in a public repo. Only the
> worker's address and the Turnstile **site** key go on your page.

## Get alerts

Both are optional; set up either or both. After adding one, nothing else to do: secrets
apply right away.

### A Discord message

1. In a Discord server of yours (a private one with only you works well): Server Settings →
   Integrations → Webhooks → New Webhook. Pick the channel and copy the webhook URL.
2. ```bash
   npx wrangler secret put DISCORD_WEBHOOK
   ```

The message shows who signed, their link and what they wrote, with a link to your admin
page. Mentions in it are switched off, so a stranger can't ping `@everyone`.

Treat the webhook URL like a password: anyone who has it can post in that channel.

### An email

Emails go through [Resend](https://resend.com), which has a free plan.

1. Make a Resend account with the email address where you want the alerts, and create an API key.
2. ```bash
   npx wrangler secret put RESEND_API_KEY
   npx wrangler secret put ALERT_EMAIL      # the same address as your Resend account
   ```

Without a domain of your own, Resend only delivers to your account's own address, which
is exactly this case. Once you have a domain verified there, you can set `ALERT_FROM`
(for example `Guestbook <guestbook@your-domain>`) and send to any address.

If an alert fails (a deleted webhook, say), the message is still saved; the failure shows
up in `npx wrangler tail`.

## Approving messages

Open `https://guestbook.YOURNAME.workers.dev/admin` and type your ADMIN_KEY. The browser
remembers you for 30 days. New messages wait at the top: **Approve** puts them on your
site, **Delete** removes them. Approved ones can be deleted later too.

The key is never part of an address, so it can't leak through your history, a
screenshot or an alert.

## Put it on your site

### Any page

```html
<leave-a-mark api="https://guestbook.you.workers.dev" site-key="0x4AAA…"></leave-a-mark>
<script src="https://cdn.jsdelivr.net/npm/leave-a-mark@1/dist/leave-a-mark.js"></script>
```

| Attribute | What it does |
| --- | --- |
| `api` | Your worker's address. |
| `site-key` | Turnstile's site key. |
| `lang` | `en` or `es`. Without it, it follows the page's `<html lang>`, also when that changes. |
| `parts` | `both` (default), `form` or `entries`, to put the form and the messages in different places. |
| `theme` | Colors of the anti-bot check: `auto` (default), `dark` or `light`. |
| `no-title` | Hides the "Messages" heading. |
| `demo` | Sample messages, and the form only pretends to send. |
| `label-…` | Changes any of the words: `label-send="Leave your mark"`. The names are in `src/labels.js`. |

It fires a `signed` event when a visitor's message has been sent.

### React and Next.js

```bash
npm install leave-a-mark
```

```jsx
import { LeaveAMark } from "leave-a-mark/react";

<LeaveAMark api="https://guestbook.you.workers.dev" siteKey="0x4AAA…" />
```

The props are the same options in camelCase (`siteKey`, `parts`, `theme`, `lang`, `demo`,
`title`, `labels`, `onSigned`). It is a client component.

### Plain JavaScript

```js
import { createGuestbook } from "leave-a-mark";

const book = createGuestbook(document.querySelector("#guestbook"), { api: "…", siteKey: "…" });
book.update({ lang: "es" });
book.reload();
book.destroy();
```

## Make it yours

It takes the font and text color of wherever you put it. These CSS variables change the
rest; set them on the guestbook or any parent:

```css
leave-a-mark {
  --lm-ink: #e7e2d6;     /* the button, names */
  --lm-on-ink: #0d0d0c;  /* the words on the button */
  --lm-muted: #918c81;   /* dates, the character count */
  --lm-line: #2b2a26;    /* borders, the lines between messages */
  --lm-accent: #7390ff;  /* focus rings, the bar beside notices */
  --lm-field: #131312;   /* background of the text fields */
  --lm-mono: "VT323", monospace; /* dates and the count */
}
```

## Good to know

- New messages are never public until you approve them.
- Each person can sign 3 times an hour. Their IP address is never stored, only a one-way
  fingerprint of it, for that limit.
- Names are up to 40 characters and messages up to 600. Everything visitors type is shown
  as plain text, never as HTML.
- The script for the anti-bot check comes from Cloudflare and loads only where the form is shown.
- With a new address for your site later, add it to `ALLOWED_ORIGINS` and to the Turnstile
  hostnames, then `npx wrangler deploy` again.
- To update: `git pull`, then `npx wrangler deploy` from `worker/`. Your `wrangler.toml`,
  your secrets and your messages stay as they are.

## Working on it

```bash
npm test         # the worker against an in-memory database, and the widget's helpers (Node 22.5 or newer)
npm run build    # rebuilds dist/leave-a-mark.js (needs npm install first)
```

## License

MIT
