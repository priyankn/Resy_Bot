# Resy availability monitor

Checks a Resy restaurant for open tables across a rolling date window and reports new slots. It never books.

> Resy's terms prohibit unauthorized scraping. Get permission before enabling polling, or use Resy's **Notify** feature.

## Install

Requires Node.js 20+ on Windows, macOS, or Linux.

```console
npm install
npx playwright install chromium
```

## Use

1. Copy `config.example.json` to `config.json` and set `venueUrl`, `partySize`, `windowDays`, and `timeZone`.
2. Set `"authorizedPolling": true` once you have permission.
3. Preview (no network requests), then run a check:

```console
npm run preview -- --config ./config.json
npm run check -- --config ./config.json
```

Any setting can be passed on the command line instead; see `node monitor.mjs --help`.

```console
node monitor.mjs --venue-url "https://resy.com/cities/<city>/venues/<venue>" --party-size 4 --window-days 14 --authorized-polling
```

Schedule hourly checks with `.\install-task.ps1 -ConfigPath .\config.json` on Windows, or cron/launchd/systemd elsewhere.

## Optional: Telegram

Without Telegram, notifications print to the console.

1. Create a bot with @BotFather and send it `/start`.
2. Set `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` as environment variables (never in config files).
3. Set `"telegram": { "enabled": true }` or pass `--telegram`.
4. Test: `npm run setup:telegram`

## Troubleshooting

| Symptom | Fix |
|---|---|
| `Polling disabled` | Set `authorizedPolling` to `true` or pass `--authorized-polling`. |
| No output at all | After the first `diagnosticRuns` checks, only new availability is reported. Check `<dataDir>/monitor.log`. |
| `Existing run; skipping.` | Another check is running. Locks from crashed runs are cleared automatically. |
| Checks paused for 24 hours | Resy returned 401/403/429 or three checks failed in a row. Wait, or delete `<dataDir>/state.json` to reset. |
| Browser fails to start | Run `npx playwright install chromium`. |
| Telegram test fails | Verify the token and chat ID, and that the bot received `/start`. |
| `Configuration error` | Fix the field named in the message; `--help` lists valid options. |

Run `npm test` to verify the install.