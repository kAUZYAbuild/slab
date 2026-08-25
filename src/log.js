const subs = new Set();
const ring = [];
const RING = 1000;

export function log(step, level, msg, extra = {}) {
  const entry = { ts: new Date().toISOString(), step, level, msg, ...extra };
  process.stdout.write(JSON.stringify(entry) + '\n');
  ring.push(entry);
  if (ring.length > RING) ring.shift();
  for (const fn of subs) fn(entry);
  return entry;
}

export function subscribe(fn) {
  subs.add(fn);
  return () => subs.delete(fn);
}

export const recent = (n = RING) => ring.slice(-n);
