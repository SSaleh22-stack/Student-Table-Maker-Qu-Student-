# QU Student feedback relay

The app's "Send feedback" screen posts to this Cloudflare Worker, and the Worker sends each message to your Telegram as a bot message. It runs on Cloudflare's free plan.

The bot token is stored only as a Worker secret. Never put it in the app or in any file in this repo.

## One-time setup

1. **Create the bot.** In Telegram, open @BotFather, send `/newbot`, and follow the steps. Copy the token it gives you.
2. **Find your chat ID.** Open your new bot and send it any message (for example `/start`). Then open this address in a browser, with your token in place of `<TOKEN>`:
   `https://api.telegram.org/bot<TOKEN>/getUpdates`
   The number at `"chat":{"id": ...}` is your chat ID.
   To receive feedback in a group instead, add the bot to the group, send a message there, and use the group's ID (it starts with `-`).
3. **Deploy the Worker.** From this folder. If PowerShell says running scripts is disabled, type `npx.cmd` instead of `npx`:

   ```powershell
   npx wrangler login
   npx wrangler secret put TELEGRAM_BOT_TOKEN
   npx wrangler secret put TELEGRAM_CHAT_ID
   npx wrangler deploy
   ```

   The deploy prints a URL like `https://qu-student-feedback.<your-name>.workers.dev`.
4. **Connect the app.** Put that URL in `FEEDBACK_URL` in `mobile-app/src/lib/feedback.ts`, then ship a new build.

## Test it

```powershell
Invoke-RestMethod -Method Post -Uri https://qu-student-feedback.<your-name>.workers.dev -ContentType 'application/json; charset=utf-8' -Body '{"type":"suggestion","message":"Test message"}'
```

You should get `ok: True` back and the message in Telegram.

## Limits

- Message: up to 2000 characters. Contact: up to 200 characters.
- Up to 5 messages per minute from one IP address (see `wrangler.toml`).
- To read errors live, run `npx wrangler tail`.
