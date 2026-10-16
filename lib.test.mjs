import test from 'node:test';
import assert from 'node:assert/strict';
import { scheduled, reservationTargets, localParts, parseAvailability, availabilityRequest, notificationKind, availabilityMessages } from './lib.mjs';
const c = { timeZone: 'America/New_York', startDate: '2030-06-15', date: '2030-06-15', partySize: 2 };
test('hourly monitoring starts on the configured date and does not expire', () => {
  assert.equal(scheduled(new Date('2030-06-14T15:00:00Z'), c), false);
  assert.equal(scheduled(new Date('2030-06-15T15:00:00Z'), c), true);
  assert.equal(scheduled(new Date('2031-01-15T15:37:00Z'), c), true);
  assert.equal(scheduled(new Date('2030-06-14T15:00:00Z'), { timeZone: c.timeZone }), true);
});
test('local time handles daylight-saving changes', () => {
  assert.equal(localParts(new Date('2030-01-15T17:00:00Z'), c.timeZone).time, '12:00');
  assert.equal(localParts(new Date('2030-06-15T16:00:00Z'), c.timeZone).time, '12:00');
});
test('rolling target window covers 30 dates including today', () => {
  const config = { ...c, windowDays: 30, venueUrl: 'https://resy.com/cities/city-slug/venues/restaurant-slug' };
  const targets = reservationTargets(new Date('2030-06-15T15:30:00Z'), config);
  assert.equal(targets.length, 30);
  assert.equal(targets[0].date, '2030-06-15');
  assert.equal(targets[29].date, '2030-07-14');
  assert.equal(new URL(targets[0].url).searchParams.get('seats'), '2');
});
test('availability responses are strict', () => {
  assert.deepEqual(parseAvailability({ results: { venues: [] } }), []);
  assert.deepEqual(parseAvailability({ results: { venues: [{ slots: [] }] } }), []);
  assert.throws(() => parseAvailability({ error: 'blocked' }));
  assert.throws(() => parseAvailability({ results: { venues: [{ slots: [{}] }] } }));
  const slots = parseAvailability({ results: { venues: [{ slots: [{ date: { start: '2030-06-15 18:00:00' }, config: { type: 'Dining Room' } }] }] } });
  assert.equal(slots[0].type, 'Dining Room');
});
test('only target-date, party-size, single-venue find requests', () => {
  assert.equal(availabilityRequest('https://api.resy.com/4/find?day=2030-06-15&party_size=2&venue_id=123', c), true);
  assert.equal(availabilityRequest('https://api.resy.com/4/find?day=2030-06-14&party_size=2&venue_id=123', c), false);
  assert.equal(availabilityRequest('https://other.test/4/find?day=2030-06-15&party_size=2&venue_id=123', c), false);
});
test('first ten runs report every outcome, including pauses and unchanged availability', () => {
  for (let run = 1; run <= 10; run++) {
    for (const outcome of ['available', 'empty', 'failure', 'paused']) {
      assert.equal(notificationKind(run, 10, outcome, false), 'diagnostic');
    }
  }
  for (const outcome of ['empty', 'failure', 'paused']) assert.equal(notificationKind(11, 10, outcome), 'none');
  assert.equal(notificationKind(11, 10, 'available'), 'availability');
  assert.equal(notificationKind(11, 10, 'available', false), 'none');
  assert.equal(notificationKind(0, 10, 'failure'), 'none');
});
test('every available time is included, with bounded Telegram messages', () => {
  const slots = Array.from({ length: 180 }, (_, i) => ({ start: `2030-06-15 option-${i}`, type: 'Dining Room' }));
  const messages = availabilityMessages(slots, 'Availability for two', 'Book manually');
  assert.ok(messages.length > 1);
  assert.ok(messages.every(m => m.length <= 3500));
  const lines = messages.flatMap(m => m.split('\n'));
  for (const slot of slots) assert.equal(lines.filter(l => l === `${slot.start} - ${slot.type}`).length, 1);
});