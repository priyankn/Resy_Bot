import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';

const options = {
  config: { type: 'string' },
  'venue-url': { type: 'string' },
  'venue-name': { type: 'string' },
  'party-size': { type: 'string' },
  'window-days': { type: 'string' },
  'start-date': { type: 'string' },
  'time-zone': { type: 'string' },
  'diagnostic-runs': { type: 'string' },
  'data-dir': { type: 'string' },
  'authorized-polling': { type: 'boolean' },
  telegram: { type: 'boolean' },
  'no-telegram': { type: 'boolean' },
  preview: { type: 'boolean', short: 'p' },
  help: { type: 'boolean', short: 'h' }
};

export const helpText = `Resy availability monitor

Usage:
  node monitor.mjs [options]

Options:
  --config <path>              JSON configuration file (default: config.json)
  --venue-url <url>            Resy restaurant URL
  --venue-name <name>          Display name; optional when URL is overridden
  --party-size <number>        Number of guests
  --window-days <number>       Rolling date window including today
  --start-date <YYYY-MM-DD>    Do not run before this restaurant-local date
  --time-zone <IANA zone>      Restaurant time zone, for example America/New_York
  --diagnostic-runs <number>   Runs that report every outcome
  --data-dir <path>            State directory, relative to the config file
  --authorized-polling         Confirm authorized polling for this invocation
  --telegram                   Enable Telegram notifications
  --no-telegram                Disable Telegram and write notifications to stdout
  --preview, -p                Print resolved settings without making requests
  --help, -h                   Show this help

Environment:
  RESY_MONITOR_CONFIG, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID`;

function integer(value, name, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} to ${maximum}`);
  }
  return parsed;
}

function validateDate(value, name) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) {
    throw new Error(`${name} must be a valid date in YYYY-MM-DD format`);
  }
}

export function loadMonitorConfig(args, root, environment = process.env, cwd = process.cwd()) {
  const { values } = parseArgs({ args, options, strict: true, allowPositionals: false });
  if (values.help) return { help: true };
  if (values.telegram && values['no-telegram']) throw new Error('--telegram and --no-telegram cannot be used together');

  const requestedPath = values.config ?? environment.RESY_MONITOR_CONFIG;
  const configPath = requestedPath ? path.resolve(cwd, requestedPath) : path.join(root, 'config.json');
  let config = {};
  if (fs.existsSync(configPath)) config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  else if (requestedPath) throw new Error(`Configuration file not found: ${configPath}`);

  if (values['venue-url']) {
    config.venueUrl = values['venue-url'];
    if (!values['venue-name']) delete config.venueName;
  }
  if (values['venue-name']) config.venueName = values['venue-name'];
  if (values['party-size']) config.partySize = integer(values['party-size'], 'partySize', 1, 20);
  if (values['window-days']) config.windowDays = integer(values['window-days'], 'windowDays', 1, 90);
  if (values['start-date']) config.startDate = values['start-date'];
  if (values['time-zone']) config.timeZone = values['time-zone'];
  if (values['diagnostic-runs']) config.diagnosticRuns = integer(values['diagnostic-runs'], 'diagnosticRuns', 0, 1000);
  if (values['data-dir']) config.dataDir = values['data-dir'];
  if (values['authorized-polling']) config.authorizedPolling = true;
  if (config.telegram !== undefined && (config.telegram === null || typeof config.telegram !== 'object' || Array.isArray(config.telegram))) {
    throw new Error('telegram must be an object');
  }
  config.telegram = { ...config.telegram };
  if (values.telegram) config.telegram.enabled = true;
  if (values['no-telegram']) config.telegram.enabled = false;

  if (typeof config.venueUrl !== 'string') throw new Error('venueUrl is required');
  const venueUrl = new URL(config.venueUrl);
  if (venueUrl.protocol !== 'https:' || !/(^|\.)resy\.com$/.test(venueUrl.hostname) || !/^\/cities\/[^/]+\/venues\/[^/]+\/?$/.test(venueUrl.pathname)) {
    throw new Error('venueUrl must be an HTTPS Resy restaurant URL');
  }
  config.venueUrl = venueUrl.toString();
  if (config.venueName !== undefined && (typeof config.venueName !== 'string' || !config.venueName.trim())) throw new Error('venueName must be a non-empty string');
  config.partySize = integer(config.partySize ?? 2, 'partySize', 1, 20);
  config.windowDays = integer(config.windowDays ?? 30, 'windowDays', 1, 90);
  config.diagnosticRuns = integer(config.diagnosticRuns ?? 10, 'diagnosticRuns', 0, 1000);
  if (config.startDate !== undefined) validateDate(config.startDate, 'startDate');
  if (typeof config.timeZone !== 'string') throw new Error('timeZone is required');
  try { new Intl.DateTimeFormat('en-US', { timeZone: config.timeZone }).format(); }
  catch { throw new Error('timeZone must be a valid IANA time zone'); }
  config.authorizedPolling ??= false;
  if (config.authorizedPolling !== true && config.authorizedPolling !== false) throw new Error('authorizedPolling must be true or false');
  if (config.dataDir !== undefined && (typeof config.dataDir !== 'string' || !config.dataDir.trim())) throw new Error('dataDir must be a non-empty string');
  config.telegram.enabled ??= false;
  if (typeof config.telegram.enabled !== 'boolean') throw new Error('telegram.enabled must be true or false');

  return { config, configPath, preview: values.preview === true, help: false };
}