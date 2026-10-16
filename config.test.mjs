import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadMonitorConfig } from './config.mjs';

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'resy-monitor-'));
  fs.writeFileSync(path.join(root, 'config.json'), JSON.stringify({
    authorizedPolling: false,
    venueName: 'Original Restaurant',
    venueUrl: 'https://resy.com/cities/new-york-ny/venues/original',
    timeZone: 'America/New_York'
  }));
  return root;
}

test('configuration supplies portable defaults', t => {
  const root = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const { config } = loadMonitorConfig([], root, {}, root);
  assert.equal(config.partySize, 2);
  assert.equal(config.windowDays, 30);
  assert.equal(config.diagnosticRuns, 10);
  assert.equal(config.telegram.enabled, false);
});

test('CLI values override the file and a new URL drops the old venue name', t => {
  const root = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const { config, preview } = loadMonitorConfig([
    '--venue-url', 'https://resy.com/cities/chicago-il/venues/another-place',
    '--party-size', '4', '--window-days', '7', '--data-dir', 'private/another',
    '--authorized-polling', '--telegram', '--preview'
  ], root, {}, root);
  assert.equal(config.venueName, undefined);
  assert.equal(config.partySize, 4);
  assert.equal(config.windowDays, 7);
  assert.equal(config.dataDir, 'private/another');
  assert.equal(config.authorizedPolling, true);
  assert.equal(config.telegram.enabled, true);
  assert.equal(preview, true);
});

test('configuration rejects unsafe or ambiguous input', t => {
  const root = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.throws(() => loadMonitorConfig(['--party-size', '0'], root, {}, root), /partySize/);
  assert.throws(() => loadMonitorConfig(['--venue-url', 'https://example.com/restaurant'], root, {}, root), /Resy restaurant URL/);
  assert.throws(() => loadMonitorConfig(['--telegram', '--no-telegram'], root, {}, root), /cannot be used together/);
});