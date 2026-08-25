const $ = (s) => document.querySelector(s);
const usd = (u) => (u / 1e6).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const money = (u) => (u < 0 ? '-$' : '$') + usd(Math.abs(u));
const age = (iso) => {
  if (!iso) return '';
  const h = (Date.now() - Date.parse(iso)) / 3.6e6;
  return h < 1 ? `${Math.max(1, Math.round(h * 60))}m` : h < 48 ? `${Math.round(h)}h` : `${Math.round(h / 24)}d`;
};
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

/* hero: wireframe-to-paint intro plays once, then the still takes over */
const video = $('#hero-video');
if (reduced) video.classList.add('hidden');
else {
  const settle = () => video.classList.add('done');
  video.addEventListener('ended', settle);
  video.addEventListener('error', settle, true);
  video.play().catch(settle);
  setTimeout(settle, 16000);
}

/* scroll reveals */
const io = new IntersectionObserver((entries) => {
  for (const en of entries) if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); }
}, { rootMargin: '0px 0px -4% 0px' });
document.querySelectorAll('.block').forEach((b) => io.observe(b));

/* numbers */
const shown = {};
function figure(key, u, { signed = false } = {}) {
  const el = document.querySelector(`[data-k="${key}"]`);
  const from = shown[key] ?? u;
  shown[key] = u;
  const start = performance.now();
  const dur = reduced || from === u ? 0 : 700;
  const step = (t) => {
    const k = dur ? Math.min(1, (t - start) / dur) : 1;
    const v = from + (u - from) * (1 - Math.pow(1 - k, 3));
    el.textContent = (signed && v > 0 ? '+' : '') + money(v);
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
  el.classList.toggle('up', signed && u > 0);
  el.classList.toggle('down', signed && u < 0);
}

async function refresh() {
  let s;
  try { s = await fetch('/api/state', { cache: 'no-store' }).then((r) => r.json()); } catch { return; }
  const p = s.pnl;
  figure('cash', p.cashU);
  figure('inventory', p.inventoryU);
  figure('fees', p.swappedToUsdcU);
  figure('compute', p.expenses.compute);
  figure('net', p.netU, { signed: true });
  const open = s.positions.filter((x) => ['held', 'listed', 'shipping'].includes(x.state));
  const sold = s.positions.filter((x) => x.state === 'sold').length;
  const candidates = s.decisions.filter((d) => d.status === 'scored').length;
  const skipped = s.listings.skipped ?? 0;
  $('#liveline').innerHTML = `<span class="dot"></span> ${s.paper ? 'paper mode · nothing is broadcast' : 'live on solana'} · cash $${usd(p.cashU)} · ${open.length} card${open.length === 1 ? '' : 's'} held · ${s.listings.new ?? 0} listings waiting · net ${money(p.netU)}`;
  $('#now-sub').textContent = `${s.paper ? 'paper' : 'live'} · last tick ${age(s.loop.lastTickAt) || 'none'} ago · comps ${s.counters.pptCredits}/${s.counters.pptBudget} today · model ${s.model ?? 'not set'}`;
  $('#p-holdings').textContent = open.length ? `${open.length} held at $${usd(p.inventoryU)} cost, ${sold} sold` : 'nothing held yet; the book is open anyway';
  $('#p-decisions').textContent = `${s.listings.new ?? 0} waiting, ${skipped} passed, ${candidates} candidates, ${s.listings.bought ?? 0} bought`;
  $('#p-ledger').textContent = `${s.transactions.length ? s.transactions.length + '+' : 0} entries, net ${money(p.netU)}, every cent booked`;
  $('#foot-mode').textContent = `${s.paper ? 'paper' : 'live'} · last tick ${age(s.loop.lastTickAt) || 'none'} ago`;
  if (s.wallet && s.wallet !== 'paper') $('#link-wallet').href = `https://solscan.io/account/${s.wallet}`;
  if (s.tokenMint) $('#link-token').href = `https://pump.fun/coin/${s.tokenMint}`;
}
refresh();
setInterval(refresh, 30_000);

function connect() {
  const es = new EventSource('/events');
  es.onmessage = (ev) => {
    const e = JSON.parse(ev.data);
    $('#p-log').textContent = `${e.ts.slice(11, 19)} ${e.step}: ${e.msg}`.slice(0, 120);
    if (['buy', 'inventory', 'fees', 'reconcile'].includes(e.step) && e.level === 'info') refresh();
  };
  es.onerror = () => { es.close(); $('.dot')?.classList.add('idle'); setTimeout(connect, 5000); };
}
connect();
