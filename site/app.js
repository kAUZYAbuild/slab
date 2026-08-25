const $ = (s) => document.querySelector(s);
const usd = (u) => (u / 1e6).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const sol = (l) => (l / 1e9).toFixed(3);
const age = (iso) => {
  if (!iso) return '';
  const h = (Date.now() - Date.parse(iso)) / 3.6e6;
  return h < 1 ? `${Math.max(1, Math.round(h * 60))}m` : h < 48 ? `${Math.round(h)}h` : `${Math.round(h / 24)}d`;
};
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

/* pointer: orbit follows, layers parallax */
const orbit = $('#orbit');
const sky = $('.sky');
const hero = $('#hero');
let mx = -100, my = -100, ox = -100, oy = -100;
addEventListener('pointermove', (e) => {
  mx = e.clientX; my = e.clientY;
  const px = (e.clientX / innerWidth - 0.5) * 2;
  const py = (e.clientY / innerHeight - 0.5) * 2;
  for (const el of [sky, hero]) { el.style.setProperty('--px', px.toFixed(3)); el.style.setProperty('--py', py.toFixed(3)); }
  const over = e.target.closest('.sky, .hero');
  orbit.classList.toggle('on-sky', Boolean(over));
  orbit.classList.toggle('wide', Boolean(e.target.closest('a, button, tbody tr, .figures p')));
}, { passive: true });
addEventListener('pointerleave', () => { mx = -100; my = -100; });
(function follow() {
  ox += (mx - ox) * 0.18; oy += (my - oy) * 0.18;
  orbit.style.setProperty('--x', ox.toFixed(1) + 'px');
  orbit.style.setProperty('--y', oy.toFixed(1) + 'px');
  requestAnimationFrame(follow);
})();

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
    el.textContent = (signed && v > 0 ? '+' : '') + '$' + usd(v);
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
  el.classList.toggle('up', signed && u > 0);
  el.classList.toggle('down', signed && u < 0);
}

function renderPositions(rows) {
  const body = $('#positions tbody');
  if (!rows.length) { body.innerHTML = '<tr><td colspan="6" class="empty">no cards held yet</td></tr>'; return; }
  body.innerHTML = rows.map((p) => {
    const id = JSON.parse(p.identity_json);
    const k = p.card_key.split('|');
    return `<tr><td>${esc(id.name)}<span class="meta">${esc(k[1])} #${esc(k[2])} psa ${esc(k.at(-1))}</span></td>
      <td class="n">${usd(p.cost_u)}</td><td class="n">${p.comp?.price_u ? usd(p.comp.price_u) : '–'}</td>
      <td class="n">${p.list_price_u ? usd(p.list_price_u) : '–'}</td><td>${esc(p.state)}${p.sold_u ? ` for $${usd(p.sold_u)}` : ''}</td><td class="n">${age(p.bought_at)}</td></tr>`;
  }).join('');
}

function renderDecisions(rows) {
  const body = $('#decision-rows tbody');
  if (!rows.length) { body.innerHTML = '<tr><td colspan="5" class="empty">nothing scored yet</td></tr>'; return; }
  body.innerHTML = rows.slice(0, 24).map((d) => {
    const call = d.status === 'bought' ? '<span class="call-bought">bought</span>'
      : d.status === 'scored' ? '<span class="call-candidate">candidate</span>'
      : `<span class="why">${esc(d.skip_reason)}</span>`;
    return `<tr><td>${esc(d.item_name)}</td><td class="n">${usd(d.price_u)}</td><td class="n">${d.score?.compU ? usd(d.score.compU) : '–'}</td>
      <td class="n">${d.score?.edgePct != null ? (d.score.edgePct * 100).toFixed(1) + '%' : '–'}</td><td>${call}</td></tr>`;
  }).join('');
}

function renderTxns(rows) {
  const ol = $('#txns');
  if (!rows.length) { ol.innerHTML = '<li class="empty">no entries yet</li>'; return; }
  ol.innerHTML = rows.slice(0, 20).map((t) => {
    const cash = t.entries.find((e) => e.account === 'Cash');
    const amt = cash ? (cash.currency === 'SOL' ? `${cash.amount > 0 ? '+' : ''}${sol(cash.amount)} SOL` : `${cash.amount > 0 ? '+' : ''}$${usd(cash.amount)}`) : '';
    return `<li><span class="t">${esc(t.ts.slice(5, 16).replace('T', ' '))}</span><span class="k ${esc(t.kind)}">${esc(t.kind)}</span><span class="m">${esc(t.memo || t.ref)}</span><span class="a">${amt}</span></li>`;
  }).join('');
}

function rulesText(text) {
  $('#rules-text').innerHTML = text.split('\n').map((l) => `<p>${esc(l)}</p>`).join('');
}

let lastState = null;
async function refresh() {
  let s;
  try { s = await fetch('/api/state', { cache: 'no-store' }).then((r) => r.json()); } catch { return; }
  lastState = s;
  const p = s.pnl;
  figure('cash', p.cashU);
  figure('inventory', p.inventoryU);
  figure('fees', p.swappedToUsdcU);
  figure('compute', p.expenses.compute);
  figure('net', p.netU, { signed: true });
  const open = s.positions.filter((x) => x.state === 'held' || x.state === 'listed').length;
  $('#liveline').innerHTML = `<span class="dot"></span> ${s.paper ? 'paper mode · nothing is broadcast' : 'live on solana'} · cash $${usd(p.cashU)} · ${open} card${open === 1 ? '' : 's'} held · ${s.listings.new ?? 0} listings waiting · net ${p.netU < 0 ? '-' : ''}$${usd(Math.abs(p.netU))}`;
  $('#now-sub').textContent = `${sol(p.cashLamports)} SOL for gas · comps ${s.counters.pptCredits}/${s.counters.pptBudget} today · model ${s.model ?? 'not set'}`;
  $('#decisions-sub').textContent = `seen ${Object.values(s.listings).reduce((a, b) => a + b, 0)} listings: ${Object.entries(s.listings).map(([k, v]) => `${v} ${k}`).join(', ')}`;
  renderPositions(s.positions);
  renderDecisions(s.decisions);
  renderTxns(s.transactions);
  if (s.rules) rulesText(s.rules);
  $('#foot-mode').textContent = `${s.paper ? 'paper' : 'live'} · last tick ${age(s.loop.lastTickAt) || 'none'} ago`;
  if (s.wallet && s.wallet !== 'paper') $('#link-wallet').href = `https://solscan.io/account/${s.wallet}`;
  if (s.tokenMint) $('#link-token').href = `https://pump.fun/coin/${s.tokenMint}`;
}
refresh();
setInterval(refresh, 30_000);

/* live log */
const box = $('#logbox');
const lines = [];
function pushLine(e) {
  lines.push(e);
  if (lines.length > 150) lines.shift();
  const el = document.createElement('span');
  el.className = `l ${e.level}`;
  el.innerHTML = `<span class="t">${esc(e.ts.slice(11, 19))}</span>${esc(e.step)} ${esc(e.msg)}`;
  box.appendChild(el);
  while (box.childElementCount > 150) box.removeChild(box.firstChild);
  box.scrollTop = box.scrollHeight;
}
function connect() {
  const es = new EventSource('/events');
  es.onmessage = (ev) => {
    const e = JSON.parse(ev.data);
    pushLine(e);
    if (['buy', 'inventory', 'fees', 'reconcile'].includes(e.step) && e.level === 'info') refresh();
  };
  es.onerror = () => { es.close(); $('.dot')?.classList.add('idle'); setTimeout(connect, 5000); };
}
connect();
