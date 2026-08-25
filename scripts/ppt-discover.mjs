// Prints the raw PokemonPriceTracker response for a known card so comps.normalizePPT
// can be pinned to the real field names. Usage: PPT_KEY=... node scripts/ppt-discover.mjs "charizard 4"
import { cfg } from '../src/config.js';

const q = process.argv[2] || 'misdreavus 200';
if (!cfg.pptKey) { console.error('PPT_KEY missing'); process.exit(1); }
for (const params of [
  { search: q, includeEbay: 'true', limit: '3' },
  { search: q, includeEbay: 'true', includeHistory: 'true', days: '90', limit: '1' },
]) {
  const url = new URL(cfg.pptBase + '/cards');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, { headers: { Authorization: `Bearer ${cfg.pptKey}`, 'User-Agent': cfg.userAgent } });
  console.log('\n###', url.search, res.status, res.headers.get('x-ratelimit-remaining') ?? '');
  console.log(JSON.stringify(await res.json().catch(() => null), null, 1).slice(0, 6000));
}
