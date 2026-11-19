/**
 * QU Student feedback relay (Cloudflare Worker).
 *
 * The app POSTs a problem, suggestion or question here and this Worker forwards it to your
 * Telegram chat through your bot. The bot token lives only here, as a Worker secret, and is
 * never shipped inside the app.
 *
 * Request:  POST /  { type, message, contact?, meta? }   (JSON)
 * Response: { ok: true } or { ok: false, error }
 *
 * Secrets:  TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID   (see README.md)
 * Binding:  LIMITER (optional rate limit per IP, set in wrangler.toml)
 */

const TYPES = {
  problem: '🛠 مشكلة',
  suggestion: '💡 اقتراح',
  question: '❓ استفسار',
};

const MAX_BODY_BYTES = 16_000;
const MAX_MESSAGE = 2000;
const MAX_CONTACT = 200;
const MAX_META = 80;
const META_FIELDS = ['app', 'platform', 'os', 'device', 'lang'];

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS },
  });

/** A trimmed string of at most `max` characters, without control characters (newlines kept). */
function clean(value, max) {
  if (typeof value !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, '').trim().slice(0, max);
}

/** Escapes text for Telegram's HTML parse mode. */
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (request.method !== 'POST') return json({ ok: false, error: 'method' }, 405);

    if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) {
      console.error('TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID is not set');
      return json({ ok: false, error: 'config' }, 500);
    }

    if (env.LIMITER) {
      const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
      const { success } = await env.LIMITER.limit({ key: ip });
      if (!success) return json({ ok: false, error: 'rate' }, 429);
    }

    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) return json({ ok: false, error: 'size' }, 413);
    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      return json({ ok: false, error: 'json' }, 400);
    }

    const type = typeof body?.type === 'string' && Object.hasOwn(TYPES, body.type) ? body.type : null;
    const message = clean(body?.message, MAX_MESSAGE);
    if (!type || message.length < 3) return json({ ok: false, error: 'invalid' }, 400);
    const contact = clean(body.contact, MAX_CONTACT);
    const meta = body.meta && typeof body.meta === 'object' ? body.meta : {};
    const details = META_FIELDS.map((k) => clean(meta[k], MAX_META)).filter(Boolean).join(' · ');

    const lines = [`<b>${TYPES[type]}</b> · QU Student`, '', esc(message)];
    if (contact) lines.push('', `📬 <b>للتواصل:</b> ${esc(contact)}`);
    if (details) lines.push('', `<i>${esc(details)}</i>`);

    const tg = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: env.TELEGRAM_CHAT_ID,
        text: lines.join('\n'),
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true },
      }),
    });
    if (!tg.ok) {
      console.error('Telegram error', tg.status, await tg.text());
      return json({ ok: false, error: 'upstream' }, 502);
    }
    return json({ ok: true });
  },
};
