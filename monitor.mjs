import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { scheduled, reservationTargets, localParts, parseAvailability, availabilityRequest, notificationKind, availabilityMessages } from './lib.mjs';
import { helpText, loadMonitorConfig } from './config.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
let loaded;
try { loaded = loadMonitorConfig(process.argv.slice(2), root); }
catch (error) { console.error(`Configuration error: ${error.message}`); process.exit(2); }
if (loaded.help) { console.log(helpText); process.exit(0); }
const { config, configPath } = loaded;
const data = path.resolve(path.dirname(configPath), config.dataDir ?? 'private');
const statePath = path.join(data, 'state.json');
const now = new Date();
const stamp = localParts(now, config.timeZone);
const targets = reservationTargets(now, config);
if (loaded.preview) {
  console.log(JSON.stringify({ venue: config.venueName ?? new URL(config.venueUrl).pathname.split('/').filter(Boolean).at(-1), targets, localTime: stamp, due: scheduled(now, config) && targets.length > 0, authorized: config.authorizedPolling, telegram: config.telegram.enabled }, null, 2));
  process.exit(0);
}
fs.mkdirSync(data, { recursive: true });
if (!scheduled(now, config) || !targets.length) process.exit(0);
if (!config.authorizedPolling) {
  console.log('Polling disabled: Resy authorization is required. See README.');
  process.exit(0);
}

const lockPath = path.join(data, 'run.lock');
let lock;
try {
  lock = fs.openSync(lockPath, 'wx');
} catch (error) {
  if (error.code !== 'EEXIST') throw error;
  const lockPid = Number.parseInt(fs.readFileSync(lockPath, 'utf8'), 10);
  let lockOwnerRunning = Number.isInteger(lockPid) && lockPid > 0;
  if (lockOwnerRunning) {
    try { process.kill(lockPid, 0); }
    catch (processError) {
      if (processError.code === 'ESRCH') lockOwnerRunning = false;
    }
  }
  if (lockOwnerRunning) { console.log('Existing run; skipping.'); process.exit(0); }
  fs.unlinkSync(lockPath);
  lock = fs.openSync(lockPath, 'wx');
}
fs.writeSync(lock, String(process.pid));
let context;
let state;
let runNumber = 0;
let stage = 'initializing local state';
const limit = config.diagnosticRuns ?? 10;
const diagnostic = () => notificationKind(runNumber, limit, 'failure') === 'diagnostic';
const venueLabel = config.venueName ?? new URL(config.venueUrl).pathname.split('/').filter(Boolean).at(-1);
const runLabel = () => `${venueLabel} check #${runNumber}${diagnostic() ? ` (diagnostic ${runNumber}/${limit})` : ''} - ${stamp.date} ${stamp.time} ${config.timeZone}`;
const targetSummary = () => `${targets[0].date} through ${targets.at(-1).date}\n${config.venueUrl}`;
const monitorKey = JSON.stringify({ venueUrl: config.venueUrl, partySize: config.partySize });
const save = () => { fs.writeFileSync(`${statePath}.tmp`, JSON.stringify(state, null, 2)); fs.renameSync(`${statePath}.tmp`, statePath); };
const log = message => fs.appendFileSync(path.join(data, 'monitor.log'), `${new Date().toISOString()} ${message}\n`);
let credentials;
function secrets() {
  if (credentials) return credentials;
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const chatId = process.env.TELEGRAM_CHAT_ID?.trim();
  if (!token || !chatId) throw new Error('TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID are required');
  credentials = { token, chatId };
  return credentials;
}
async function notify(text) {
  if (!config.telegram.enabled) {
    console.log(text);
    return;
  }
  const { token, chatId } = secrets();
  // Never log request URLs, raw HTTP errors, credentials, or Telegram responses.
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, link_preview_options: { is_disabled: true } }),
      signal: AbortSignal.timeout(10000)
    });
    const j = await r.json();
    if (!r.ok || j.ok !== true) throw new Error();
  } catch { throw new Error('Telegram delivery failed'); }
}
try {
  state = fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, 'utf8')) : {};
  if (state.monitorKey && state.monitorKey !== monitorKey) state = {};
  state.monitorKey = monitorKey;
  const key = `${stamp.date} ${stamp.time}`;
  if (state.lastRun === key) process.exitCode = 0;
  else {
    state.lastRun = key;
    state.runCount = (state.runCount ?? 0) + 1;
    runNumber = state.runCount;
    save();
    if (config.telegram.enabled) {
      stage = 'reading Telegram credentials';
      secrets(); // Fail before contacting Resy if notification setup is missing.
    }
    if (state.pausedUntil && now.getTime() < state.pausedUntil) {
      log(`Check #${runNumber}: skipped during safety pause.`);
      if (diagnostic()) {
        stage = 'sending safety-pause notification';
        const until = localParts(new Date(state.pausedUntil), config.timeZone);
        await notify(`${runLabel()}\nPAUSED: No availability request was made. Safety pause ends ${until.date} ${until.time} New York. Availability is unknown.\n${targetSummary()}`);
      }
    } else {
      stage = 'starting dedicated browser';
      context = await chromium.launchPersistentContext(path.join(data, 'browser-profile'), { headless: true, timeout: 15000 });
      state.lastAvailabilityByDate ??= {};
      const failures = [];
      for (const target of targets) {
        const targetConfig = { ...config, ...target };
        const page = await context.newPage();
        try {
          // Observe the ordinary website's own response, not a copied private API key.
          const found = page.waitForResponse(r => availabilityRequest(r.url(), targetConfig, r.request().postData()), { timeout: 25000 });
          found.catch(() => {});
          stage = `loading Resy for ${target.date} and waiting for the target availability response`;
          await page.goto(target.url, { waitUntil: 'domcontentloaded', timeout: 25000 });
          const response = await found;
          if ([401, 403, 429].includes(response.status())) {
            stage = `handling HTTP ${response.status()} access restriction or rate limit for ${target.date}`;
            state.pausedUntil = now.getTime() + 24 * 60 * 60 * 1000;
            save();
            throw new Error('Access restriction or rate limit; monitoring paused for 24 hours');
          }
          stage = `validating ${target.date} availability response (HTTP ${response.status()})`;
          if (!response.ok()) throw new Error('Availability endpoint returned an error');
          const heading = config.venueName
            ? page.getByRole('heading', { name: config.venueName, exact: true, level: 1 })
            : page.getByRole('heading', { level: 1 }).first();
          await heading.waitFor({ timeout: 10000 });
          if (new URL(page.url()).pathname !== new URL(target.url).pathname) throw new Error('Unexpected venue navigation');
          stage = `parsing and validating ${target.date} reservation times`;
          const slots = parseAvailability(await response.json());
          if (slots.some(slot => !slot.start.startsWith(target.date))) throw new Error('Unexpected reservation date');
          const fingerprint = JSON.stringify(slots);
          const kind = notificationKind(runNumber, limit, slots.length ? 'available' : 'empty', fingerprint !== state.lastAvailabilityByDate[target.date]);
          if (slots.length && kind !== 'none') {
            const header = `${runLabel()}\nAVAILABLE: ${slots.length} options for ${config.partySize} guests on ${target.date}. Times below are restaurant-local.`;
            const footer = `Book manually: ${target.url}\nAvailability may disappear before you book.`;
            stage = `delivering ${target.date} availability notification`;
            for (const text of availabilityMessages(slots, header, footer)) await notify(text);
            state.lastAvailabilityByDate[target.date] = fingerprint;
            log(`Availability alert delivered for ${target.date} (${slots.length} slots).`);
          } else if (!slots.length) {
            state.lastAvailabilityByDate[target.date] = '';
            log(`No availability for ${target.date}.`);
            if (kind === 'diagnostic') {
              stage = `delivering ${target.date} no-availability notification`;
              await notify(`${runLabel()}\nSUCCESS: No available tables for ${config.partySize} on ${target.date}, at any dining time.\n${target.url}`);
            }
          } else log(`Unchanged availability for ${target.date}; duplicate alert suppressed.`);
        } catch {
          failures.push(`${target.date} while ${stage}`);
          log(`Check #${runNumber} failed for ${target.date} while ${stage}; availability unknown.`);
        } finally {
          await page.close();
        }
        if (state.pausedUntil > now.getTime()) break;
      }
      if (failures.length) {
        stage = failures.join('; ');
        throw new Error('One or more target checks failed');
      }
      state.failures = 0;
      state.pausedUntil = 0;
      save();
    }
  }
} catch (error) {
  // Only locally defined messages are safe; do not print browser/network exceptions.
  log(`Check #${runNumber} failed while ${stage}; availability unknown.`);
  if (state) {
    state.failures = (state.failures ?? 0) + 1;
    if (state.failures >= 3) state.pausedUntil = Date.now() + 24 * 60 * 60 * 1000;
    if (diagnostic()) {
      const pause = state.pausedUntil > Date.now() ? ' Polling is safety-paused for 24 hours; scheduled diagnostic runs will report the pause.' : '';
      try { await notify(`${runLabel()}\nFAILURE while ${stage}. No reliable availability conclusion.${pause}\n${targetSummary()}`); }
      catch { log('Error notification failed.'); }
    }
    save();
  }
  process.exitCode = 1;
} finally {
  try { await context?.close(); }
  finally { fs.closeSync(lock); fs.unlinkSync(lockPath); }
}