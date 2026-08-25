const $ = (s) => document.querySelector(s);
const usd = (u) => (u / 1e6).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const money = (u) => (u < 0 ? '-$' : '$') + usd(Math.abs(u));
const sol = (l) => (l / 1e9).toFixed(4);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const age = (iso) => {
  if (!iso) return '';
  const h = (Date.now() - Date.parse(iso)) / 3.6e6;
  return h < 1 ? `${Math.max(1, Math.round(h * 60))}m` : h < 48 ? `${Math.round(h)}h` : `${Math.round(h / 24)}d`;
};
const days = (a, b) => Math.max(0, Math.round((Date.parse(b ?? new Date().toISOString()) - Date.parse(a)) / 864e5));
const when = (iso) => (iso ? iso.slice(5, 16).replace('T', ' ') : '');
const pct = (x) => (x == null ? '–' : `${(x * 100).toFixed(1)}%`);
const cardLine = (id, key) => {
  const k = (key ?? '').split('|');
  return `${esc(id?.name ?? '?')}<span class="meta">${esc(id?.set ?? k[1] ?? '')} #${esc(id?.number ?? k[2] ?? '')} psa ${esc(id?.grade ?? k.at(-1) ?? '')}${id?.cert ? ` · <a href="https://www.psacard.com/cert/${esc(id.cert)}" target="_blank" rel="noopener">cert ${esc(id.cert)}</a>` : ''}</span>`;
};
const solscan = (sig) => (sig ? `<a href="https://solscan.io/tx/${esc(sig)}" target="_blank" rel="noopener">${esc(sig.slice(0, 6))}…</a>` : '–');
const kv = (el, pairs) => { el.innerHTML = pairs.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join(''); };

async function state() { return fetch('/api/state', { cache: 'no-store' }).then((r) => r.json()); }

function header(s) {
  const p = s.pnl;
  const open = s.positions.filter((x) => ['held', 'listed', 'shipping'].includes(x.state)).length;
  $('#liveline').innerHTML = `<span class="dot"></span> ${s.paper ? 'paper' : 'live'} · cash $${usd(p.cashU)} · ${open} held · net ${money(p.netU)}`;
  $('#foot-mode').textContent = `${s.paper ? 'paper' : 'live'} · last tick ${age(s.loop.lastTickAt) || 'none'} ago`;
}

/* holdings */
async function holdings() {
  const s = await state();
  header(s);
  const p = s.pnl;
  const open = s.positions.filter((x) => x.state === 'held' || x.state === 'listed' || x.state === 'stuck');
  const ship = s.positions.filter((x) => x.state === 'shipping');
  const sold = s.positions.filter((x) => x.state === 'sold');
  const floor = (cost) => Math.ceil((cost * s.cfg.sellMargin) / (1 - s.cfg.ccFee));
  const marked = open.reduce((a, x) => a + (x.comp?.price_u ?? x.cost_u), 0);
  const unreal = open.reduce((a, x) => a + (x.comp?.price_u ? Math.floor(x.comp.price_u * (1 - s.cfg.ccFee)) - x.cost_u : 0), 0);
  const set = (k, v) => { $(`[data-k="${k}"]`).textContent = v; };
  set('cash', money(p.cashU)); set('inventory', money(p.inventoryU)); set('marked', money(marked)); set('unrealised', money(unreal));
  set('realised', money(p.revenueSalesU - p.cogsU - p.expenses.platformFee)); set('sol', sol(p.cashLamports));
  $('#h-sub').textContent = `${open.length} open, ${ship.length} in transit, ${sold.length} sold · ${s.paper ? 'paper mode' : 'live'}`;
  $('#h-open-n').textContent = open.length || '';
  $('#h-open tbody').innerHTML = open.length ? open.map((x) => {
    const id = JSON.parse(x.identity_json);
    const nowNet = x.list_price_u ? Math.floor(x.list_price_u * (1 - s.cfg.ccFee)) - x.cost_u : null;
    return `<tr><td>${cardLine(id, x.card_key)}<span class="meta"><a href="https://solscan.io/token/${esc(x.nft_address)}" target="_blank" rel="noopener">token</a></span></td>
      <td class="n">${usd(x.cost_u)}</td><td class="n">${x.comp_at_buy_u ? usd(x.comp_at_buy_u) : '–'}</td><td class="n">${x.comp?.price_u ? usd(x.comp.price_u) : '–'}</td>
      <td class="n">${x.list_price_u ? usd(x.list_price_u) : '–'}</td><td class="n">${usd(floor(x.cost_u))}</td>
      <td class="n ${nowNet == null ? '' : nowNet >= 0 ? 'up' : 'down'}">${nowNet == null ? '–' : money(nowNet)}</td>
      <td>${esc(x.state)}${x.note ? `<span class="meta">${esc(x.note)}</span>` : ''}</td><td class="n">${days(x.bought_at)}d</td><td class="n">${x.last_reprice_at ? age(x.last_reprice_at) + ' ago' : '–'}</td></tr>`;
  }).join('') : '<tr><td colspan="10" class="empty">no cards held yet</td></tr>';
  $('#h-ship-n').textContent = ship.length || '';
  $('#h-shipping tbody').innerHTML = ship.length ? ship.map((x) => `<tr><td>${cardLine(JSON.parse(x.identity_json), x.card_key)}</td><td class="n">${usd(x.cost_u)}</td><td>${esc(x.nft_address.replace('sp3nd:', ''))}</td><td class="n">${age(x.bought_at)} ago</td></tr>`).join('')
    : '<tr><td colspan="4" class="empty">nothing in transit</td></tr>';
  $('#h-sold-n').textContent = sold.length || '';
  $('#h-sold tbody').innerHTML = sold.length ? sold.map((x) => {
    const net = Math.floor(x.sold_u * (1 - s.cfg.ccFee));
    const profit = net - x.cost_u;
    return `<tr><td>${cardLine(JSON.parse(x.identity_json), x.card_key)}</td><td class="n">${usd(x.cost_u)}</td><td class="n">${usd(x.sold_u)}</td><td class="n">${usd(net)}</td>
      <td class="n ${profit >= 0 ? 'up' : 'down'}">${money(profit)}</td><td class="n">${days(x.bought_at, x.sold_at)}</td><td>${solscan(x.sale_sig)}</td></tr>`;
  }).join('') : '<tr><td colspan="7" class="empty">nothing sold yet</td></tr>';
  kv($('#h-wallet'), [
    ['wallet', s.wallet === 'paper' ? 'paper, no key loaded' : `<a href="https://solscan.io/account/${esc(s.wallet)}" target="_blank" rel="noopener">${esc(s.wallet)}</a>`],
    ['ledger vs chain', s.driftFlag ? `<span class="down">drift ${esc(s.driftFlag)}; buys blocked until the operator acknowledges</span>` : 'in agreement'],
    ['cash reserve', `keeps $${usd(s.cfg.minCashReserveU)} untouched for compute and hosting`],
    ['gas reserve', `keeps SOL for fees; swaps the rest to USDC`],
    ['positions', `${open.length + ship.length} of ${s.cfg.maxOpen} allowed`],
    ['today’s buys', `$${usd(s.spentTodayU)} of $${usd(s.cfg.dailyCapU)} cap`],
    ['ticket', `$${usd(s.cfg.minTicketU)} to $${usd(s.cfg.maxTicketU)}, never over ${s.cfg.maxPosPct * 100}% of bankroll`],
    ['comps credits', `${s.counters.pptCredits} of ${s.counters.pptBudget} used today`],
    ['inference', s.model ? `${esc(s.model)} · $${usd(s.counters.llmSpentTodayU)} today over ${s.counters.llmCallsToday} calls` : 'no model configured'],
  ]);
}

/* decisions */
async function decisions() {
  const [s, d] = await Promise.all([state(), fetch('/api/decisions', { cache: 'no-store' }).then((r) => r.json())]);
  header(s);
  const counts = Object.fromEntries(d.funnel.map((r) => [r.status, r.n]));
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const stages = [['seen', total], ['waiting', counts.new ?? 0], ['skipped', counts.skipped ?? 0], ['candidates', counts.scored ?? 0], ['bought', counts.bought ?? 0], ['gone', counts.gone ?? 0]];
  $('#d-funnel').innerHTML = stages.map(([k, n]) => `<div class="frow"><span class="fk">${k}</span><span class="fbar"><i style="width:${total ? Math.max(0.5, (n / total) * 100) : 0}%"></i></span><span class="fn mono">${n}</span></div>`).join('');
  $('#d-sub').textContent = `${total} listings seen in the $${usd(s.cfg.minTicketU)}–$${usd(s.cfg.maxTicketU)} band · comps ${s.counters.pptCredits}/${s.counters.pptBudget} today`;
  $('#d-reasons').innerHTML = d.reasons.length ? d.reasons.map((r) => `<li><span class="mono">${r.n}</span> ${esc(r.reason)}</li>`).join('') : '<li class="muted">nothing skipped yet</li>';
  const rows = d.rows;
  const render = (f) => {
    const list = rows.filter((r) => f === 'all' || (f === 'candidate' && r.status === 'scored') || (f === 'bought' && r.status === 'bought') || (f === 'skipped' && r.status === 'skipped'));
    $('#d-count').textContent = `${list.length} shown`;
    $('#d-rows tbody').innerHTML = list.length ? list.map((r) => {
      const sc = r.score ?? {};
      const comp = r.comp_u ? `$${usd(r.comp_u)}<span class="meta">${esc(r.confidence ?? '')}${r.comp_n ? `, ${r.comp_n} sales` : ''}${r.comp_latest ? `, last ${age(r.comp_latest)} ago` : ''}</span>` : '–';
      const call = r.status === 'bought' ? '<span class="call-bought">bought</span>' : r.status === 'scored' ? '<span class="call-candidate">candidate</span>' : `<span class="why">${esc(r.skip_reason)}</span>`;
      return `<tr><td class="n">${when(r.seen_at)}</td><td>${esc(r.item_name)}</td><td class="n">${usd(r.price_u)}</td><td class="n">${r.insured_u ? usd(r.insured_u) : '–'}</td><td>${comp}</td>
        <td class="n">${sc.haircut ? sc.haircut.toFixed(2) : '–'}</td><td class="n">${sc.expectedU ? usd(sc.expectedU) : '–'}</td><td class="n">${sc.netU ? usd(sc.netU) : '–'}</td>
        <td class="n ${sc.edgeU > 0 ? 'up' : ''}">${sc.edgeU != null ? `${money(sc.edgeU)}<span class="meta">${pct(sc.edgePct)}</span>` : '–'}</td><td class="n">${sc.floorU ? usd(sc.floorU) : '–'}</td><td>${call}</td></tr>`;
    }).join('') : '<tr><td colspan="11" class="empty">nothing in this filter yet</td></tr>';
  };
  render('all');
  $('#d-filters').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    for (const x of $('#d-filters').querySelectorAll('button')) x.classList.toggle('on', x === b);
    render(b.dataset.f);
  });
}

/* ledger */
async function ledger() {
  const [s, g] = await Promise.all([state(), fetch('/api/ledger', { cache: 'no-store' }).then((r) => r.json())]);
  header(s);
  const p = g.pnl;
  const earnedU = p.swappedToUsdcU + p.revenueSalesU;
  const capitalU = p.operatorCapitalU;
  const share = earnedU + capitalU > 0 ? earnedU / (earnedU + capitalU) : 0;
  const balanced = Object.values(g.imbalance).every((v) => v === 0);
  $('#g-sub').innerHTML = `double-entry, integer units, nothing edited after the fact · ${balanced ? 'balanced' : '<span class="down">UNBALANCED</span>'}`;
  kv($('#g-source'), [
    ['operator capital', `${money(capitalU)}${p.operatorCapitalLamports ? ` and ${sol(p.operatorCapitalLamports)} SOL` : ''}${s.paper ? ' (paper bankroll)' : ''}`],
    ['earned by the agent', `${money(earnedU)} <span class="meta">fees swapped to USDC ${money(p.swappedToUsdcU)} + card sales ${money(p.revenueSalesU)}</span>`],
    ['fees received', `${sol(p.feesReceivedLamports)} SOL`],
    ['self-funded share', `<b class="${share > 0 ? 'up' : ''}">${(share * 100).toFixed(1)}%</b> of everything that has ever come into the wallet`],
  ]);
  kv($('#g-pnl'), [
    ['card sales', money(p.revenueSalesU)],
    ['cost of cards sold', money(-p.cogsU)],
    ['venue fees', money(-p.expenses.platformFee)],
    ['fee income swapped', money(p.swappedToUsdcU)],
    ['compute', money(-p.expenses.compute)],
    ['hosting', money(-p.expenses.hosting)],
    ['gas', `${sol(-p.expenses.gas)} SOL`],
    ['net', `<b class="${p.netU >= 0 ? 'up' : 'down'}">${money(p.netU)}</b>`],
    ['inventory at cost', money(p.inventoryU)],
  ]);
  const sums = {};
  $('#g-balances tbody').innerHTML = g.balances.map((b) => { sums[b.currency] = (sums[b.currency] ?? 0) + b.balance; return `<tr><td>${esc(b.account)}</td><td>${esc(b.currency)}</td><td class="n">${b.currency === 'SOL' ? sol(b.balance) : usd(b.balance)}</td></tr>`; }).join('')
    + Object.entries(sums).map(([c, v]) => `<tr class="sum"><td>sum</td><td>${c}</td><td class="n ${v === 0 ? 'up' : 'down'}">${c === 'SOL' ? sol(v) : usd(v)}</td></tr>`).join('');
  $('#g-n').textContent = g.txns.length ? `last ${g.txns.length}` : '';
  $('#g-journal').innerHTML = g.txns.length ? g.txns.map((t) => `<li><div class="jhead"><span class="t mono">${when(t.ts)}</span><span class="k ${esc(t.kind)}">${esc(t.kind)}</span><span class="m">${esc(t.memo || '')}</span><span class="ref mono">${esc(t.ref)}</span></div>
    <div class="jentries">${t.entries.map((e) => `<span><span class="acct">${esc(e.account)}</span><span class="amt mono ${e.amount >= 0 ? 'dr' : 'cr'}">${e.currency === 'SOL' ? sol(e.amount) + ' SOL' : money(e.amount)}</span></span>`).join('')}</div></li>`).join('')
    : '<li class="empty">no entries yet</li>';
}

/* log */
async function logPage() {
  const s = await state();
  header(s);
  const box = $('#logbox');
  const all = [];
  let level = 'all', step = '', paused = false, last = null, lastEl = null, repeat = 1;
  const steps = new Set();
  const show = (e) => (level === 'all' || e.level !== 'info') && (!step || e.step === step);
  const add = (e, live) => {
    all.push(e);
    if (!steps.has(e.step)) { steps.add(e.step); $('#l-step').insertAdjacentHTML('beforeend', `<option value="${esc(e.step)}">${esc(e.step)}</option>`); }
    if (!show(e)) return;
    if (last && last.step === e.step && last.msg === e.msg && lastEl) { repeat++; lastEl.querySelector('.rep').textContent = `×${repeat}`; lastEl.querySelector('.t').textContent = e.ts.slice(11, 19); return; }
    repeat = 1; last = e;
    lastEl = document.createElement('span');
    lastEl.className = `l ${e.level}`;
    lastEl.innerHTML = `<span class="t">${esc(e.ts.slice(11, 19))}</span><span class="step">${esc(e.step)}</span>${esc(e.msg)}<span class="rep"></span>`;
    box.appendChild(lastEl);
    while (box.childElementCount > 600) box.removeChild(box.firstChild);
    if (!paused) box.scrollTop = box.scrollHeight;
  };
  const redraw = () => { box.innerHTML = ''; last = null; lastEl = null; const copy = all.splice(0); for (const e of copy) add(e); $('#l-count').textContent = `${box.childElementCount} lines`; };
  const hist = await fetch('/api/log', { cache: 'no-store' }).then((r) => r.json());
  for (const e of hist.entries) add(e);
  $('#l-count').textContent = `${box.childElementCount} lines`;
  $('#l-runs tbody').innerHTML = hist.runs.map((r) => `<tr><td>${esc(r.name)}</td><td>${age(r.last_at)} ago</td><td class="${r.last_ok ? 'up' : 'down'}">${r.last_ok ? 'ok' : 'error'}</td><td class="why">${esc(r.note ?? '')}</td></tr>`).join('');
  $('#l-filters').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.id === 'l-pause') { paused = !paused; b.textContent = paused ? 'resume' : 'pause'; b.classList.toggle('on', paused); return; }
    level = b.dataset.level; for (const x of $('#l-filters').querySelectorAll('button[data-level]')) x.classList.toggle('on', x === b); redraw();
  });
  $('#l-step').addEventListener('change', (e) => { step = e.target.value; redraw(); });
  const connect = () => {
    const es = new EventSource('/events');
    let skip = hist.entries.length ? new Set(hist.entries.slice(-100).map((e) => e.ts + e.msg)) : new Set();
    es.onmessage = (ev) => { const e = JSON.parse(ev.data); if (skip.has(e.ts + e.msg)) return; skip = new Set(); add(e, true); $('#l-count').textContent = `${box.childElementCount} lines`; };
    es.onerror = () => { es.close(); setTimeout(connect, 5000); };
  };
  connect();
  setInterval(async () => { const h = await fetch('/api/log', { cache: 'no-store' }).then((r) => r.json()).catch(() => null); if (h) $('#l-runs tbody').innerHTML = h.runs.map((r) => `<tr><td>${esc(r.name)}</td><td>${age(r.last_at)} ago</td><td class="${r.last_ok ? 'up' : 'down'}">${r.last_ok ? 'ok' : 'error'}</td><td class="why">${esc(r.note ?? '')}</td></tr>`).join(''); }, 30_000);
}

const pages = { holdings, decisions, ledger, log: logPage };
const run = pages[document.body.dataset.page];
if (run) { run(); if (document.body.dataset.page !== 'log') setInterval(run, 30_000); }
