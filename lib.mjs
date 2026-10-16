export function notificationKind(run, limit, outcome, changed = true) {
  if (Number.isInteger(run) && run > 0 && run <= limit) return 'diagnostic';
  return outcome === 'available' && changed ? 'availability' : 'none';
}

export function availabilityMessages(slots, header, footer) {
  const messages = [];
  let text = header;
  for (const slot of slots) {
    const line = `${slot.start} - ${slot.type}`;
    if (line.length > 1500) throw new Error('Unexpected slot label length');
    if (text.length + line.length + footer.length + 2 > 3500) {
      messages.push(`${text}\n${footer}`);
      text = `${header}\n(continued)`;
    }
    text += `\n${line}`;
  }
  messages.push(`${text}\n${footer}`);
  return messages;
}

export function localParts(now, zone) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(now).map(x => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

export function scheduled(now, config) {
  return !config.startDate || localParts(now, config.timeZone).date >= config.startDate;
}

export function reservationTargets(now, config) {
  const { date } = localParts(now, config.timeZone);
  const first = Date.parse(`${date}T00:00:00Z`);
  return Array.from({ length: config.windowDays }, (_, offset) => {
    const targetDate = new Date(first + offset * 86400000).toISOString().slice(0, 10);
    const url = new URL(config.venueUrl);
    url.searchParams.set('date', targetDate);
    url.searchParams.set('seats', String(config.partySize));
    return { date: targetDate, url: url.toString() };
  });
}

export function parseAvailability(json) {
  const venues = json?.results?.venues;
  if (!Array.isArray(venues)) throw new Error('Unexpected availability response');
  // A single-venue request must not alert for another restaurant.
  if (venues.length > 1) throw new Error('Unexpected multi-venue response');
  if (!venues.length) return [];
  if (!Array.isArray(venues[0].slots)) throw new Error('Missing slots');
  return venues[0].slots.map(s => {
    if (typeof s?.date?.start !== 'string') throw new Error('Unexpected slot format');
    return { start: s.date.start, type: s.config?.type ?? 'Table' };
  }).sort((a, b) => a.start.localeCompare(b.start) || a.type.localeCompare(b.type));
}

export function availabilityRequest(rawUrl, config, postData) {
  const u = new URL(rawUrl);
  if (u.hostname !== 'api.resy.com' || !/^\/\d+\/find\/?$/.test(u.pathname)) return false;
  let fields = Object.fromEntries(u.searchParams);
  if (postData) {
    try { fields = { ...fields, ...JSON.parse(postData) }; }
    catch { fields = { ...fields, ...Object.fromEntries(new URLSearchParams(postData)) }; }
  }
  return fields.day === config.date && Number(fields.party_size) === config.partySize &&
    /^\d+$/.test(String(fields.venue_id ?? ''));
}