// One page, server-rendered, house style. Numbers come from state(); the
// "how it decides" text is generated from cfg so it cannot drift from the code.
import { usd, sol } from './config.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const short = (a) => (a ? `${a.slice(0, 4)}..${a.slice(-4)}` : '');
const age = (iso) => {
  if (!iso) return '';
  const h = (Date.now() - Date.parse(iso)) / 3_600_000;
  return h < 1 ? `${Math.round(h * 60)}m` : h < 48 ? `${Math.round(h)}h` : `${Math.round(h / 24)}d`;
};
const pct = (x) => (x == null ? '' : `${(x * 100).toFixed(1)}%`);

const MASCOT = `
 .---------------.
 |  PSA     <b>10</b>   |
 |  .---------.  |
 |  |  .   .  |  |
 |  |    v    |  |
 |  |  \\___/  |  |
 |  '---------'  |
 '---------------'`;

const CSS = `
:root{--paper:#f2e8d2;--ink:#2b2418;--muted:#7a6a4f;--faint:#b6a586;--accent:#a4501f;--code:#e8dcc0}
*{box-sizing:border-box}
body{margin:0;background:var(--paper);color:var(--ink);font-family:"IBM Plex Mono",ui-monospace,Menlo,monospace;font-size:14px;line-height:1.7;
background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.04'/%3E%3C/svg%3E")}
main{max-width:78ch;margin:0 auto;padding:5vh 24px 14vh}
h1{font-weight:600;font-size:1.5rem;letter-spacing:.35em;padding-left:.35em;text-align:center;margin:1rem 0 .2rem}
h2{font-weight:600;font-size:1rem;margin:3rem 0 .8rem}h2::before{content:"# ";color:var(--accent)}
.tag{text-align:center;color:var(--muted);font-size:13px;margin:0 0 .6rem}
.mode{text-align:center;font-size:12px;letter-spacing:.12em;color:var(--muted)}.mode b{color:var(--accent);font-weight:600}
pre{margin:0;font-size:12.5px;line-height:1.45;overflow-x:auto;max-width:100%}
pre.art{width:fit-content;margin:0 auto;color:var(--ink)}pre.art b{color:var(--accent);font-weight:600}
dl{display:grid;grid-template-columns:max-content 1fr;gap:.15rem 1.2rem;margin:0}dt{color:var(--muted)}dd{margin:0}
table{width:100%;border-collapse:collapse;font-size:12.5px;margin:.4rem 0}
th,td{text-align:left;padding:.3rem .7rem .3rem 0;border-bottom:1px dashed var(--faint);vertical-align:top}th{color:var(--muted);font-weight:600}
td.n,th.n{text-align:right;white-space:nowrap}
.muted{color:var(--muted)}.ok{color:var(--accent)}
pre.log{background:var(--code);border-left:2px solid var(--accent);padding:.7rem .9rem;height:20rem;overflow-y:auto;white-space:pre-wrap;word-break:break-word}
p{margin:0 0 1rem}code{background:var(--code);padding:0 .35ch}
footer{margin-top:8vh;text-align:center;color:var(--faint);font-size:12px}a{color:var(--accent);text-decoration:none;border-bottom:1px solid var(--faint)}
`;

export function decides(c) {
  const h = c.haircut;
  return `Only PSA-graded Pokemon cards listed in USDC on Collector Crypt, grade 8 or better, priced between $${usd(c.minTicketU)} and $${usd(c.maxTicketU)}.
For each one it looks up what the same card in the same grade actually sold for on eBay. If there are not enough recent sales it does nothing.
Expected sale = comp x ${h[10]} for PSA 10, ${h[9]} for PSA 9, ${h[8]} for PSA 8, minus ${c.nonEnglishPenalty * 100} points for non-English, ${c.promoPenalty * 100} for promos, ${c.medPenalty * 100} when the comp is thin; and never above ${c.floorUndercut * 100}% of the cheapest other copy on the venue.
Net = expected x ${1 - c.ccFee} (venue fee). It buys when net minus price is at least ${c.minEdge * 100}% of price, the card is under ${c.maxPosPct * 100}% of bankroll, fewer than ${c.maxOpen} positions are open, today's buys stay under $${usd(c.dailyCapU)}, and $${usd(c.minCashReserveU)} stays in reserve for compute and hosting.
It lists at the expected sale price, drops ${c.repriceStep * 100}% every ${c.repriceDays} days, never below cost x ${c.sellMargin} net, and after ${c.stuckDays} days at the floor it holds and says so.
No model decides a trade. Inference is paid per request from the same wallet and every cent, including $${usd(c.hostingU)} a month of hosting, is booked.`;
}

export function render(s) {
  const p = s.pnl;
  const positions = s.positions.map((x) => `<tr><td>${esc(JSON.parse(x.identity_json).name)} <span class="muted">${esc(x.card_key.split('|').slice(1, 3).join(' #'))} psa ${esc(x.card_key.split('|').at(-1))}</span></td>
    <td class="n">${usd(x.cost_u)}</td><td class="n">${x.comp?.price_u ? usd(x.comp.price_u) : '-'}</td><td class="n">${x.list_price_u ? usd(x.list_price_u) : '-'}</td>
    <td>${esc(x.state)}${x.sold_u ? ` ${usd(x.sold_u)}` : ''}</td><td class="n">${age(x.bought_at)}</td></tr>`).join('');
  const decisions = s.decisions.map((d) => `<tr><td>${esc(d.item_name)}</td><td class="n">${usd(d.price_u)}</td>
    <td class="n">${d.score?.compU ? usd(d.score.compU) : '-'}</td><td class="n">${pct(d.score?.edgePct)}</td>
    <td>${d.status === 'bought' ? '<span class="ok">bought</span>' : d.status === 'scored' ? '<span class="ok">candidate</span>' : esc(d.skip_reason)}</td></tr>`).join('');
  const listings = Object.entries(s.listings).map(([k, v]) => `${k} ${v}`).join(', ') || 'none yet';
  const runs = s.runs.map((r) => `${r.name} ${r.last_ok ? 'ok' : 'err'} ${age(r.last_at)}${r.note ? ` (${esc(r.note)})` : ''}`).join(' · ');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>slab</title><style>${CSS}</style></head><body><main>
<pre class="art">${MASCOT}</pre>
<h1>slab</h1>
<p class="tag">a graded-card collector agent that pays its own way</p>
<p class="mode">${s.paper ? '<b>paper</b> · nothing is broadcast' : '<b>live</b>'} · wallet ${esc(s.wallet)}${s.tokenMint ? ` · token ${short(s.tokenMint)}` : ''} · last tick ${age(s.loop.lastTickAt) || 'none'}</p>

<h2>bankroll</h2>
<dl><dt>cash</dt><dd>${usd(p.cashU)} USDC</dd><dt>inventory at cost</dt><dd>${usd(p.inventoryU)} USDC</dd>
<dt>sol</dt><dd>${sol(p.cashLamports)} SOL</dd>
${s.driftFlag ? `<dt>drift</dt><dd class="ok">${esc(s.driftFlag)} (buys blocked until acknowledged)</dd>` : ''}
${Object.values(s.imbalance).some((v) => v !== 0) ? `<dt>ledger</dt><dd class="ok">UNBALANCED ${esc(JSON.stringify(s.imbalance))}</dd>` : ''}</dl>

<h2>fees</h2>
<dl><dt>received</dt><dd>${sol(p.feesReceivedLamports)} SOL</dd><dt>swapped to usdc</dt><dd>${usd(p.swappedToUsdcU)} USDC</dd></dl>

<h2>compute</h2>
<dl><dt>spent</dt><dd>${usd(p.expenses.compute)} USDC total, ${usd(s.counters.llmSpentTodayU)} today over ${s.counters.llmCallsToday} calls</dd>
<dt>model</dt><dd>${esc(s.model ?? 'not configured')}</dd><dt>comps credits</dt><dd>${s.counters.pptCredits} / ${s.counters.pptBudget} today</dd>
<dt>hosting</dt><dd>${usd(p.expenses.hosting)} USDC paid back so far</dd></dl>

<h2>positions</h2>
${positions ? `<table><tr><th>card</th><th class="n">cost</th><th class="n">comp</th><th class="n">listed</th><th>state</th><th class="n">age</th></tr>${positions}</table>` : '<p class="muted">none yet</p>'}

<h2>p&amp;l</h2>
<dl><dt>sales</dt><dd>${usd(p.revenueSalesU)}</dd><dt>cost of cards sold</dt><dd>${usd(p.cogsU)}</dd><dt>venue fees</dt><dd>${usd(p.expenses.platformFee)}</dd>
<dt>compute</dt><dd>${usd(p.expenses.compute)}</dd><dt>hosting</dt><dd>${usd(p.expenses.hosting)}</dd><dt>net</dt><dd class="ok">${usd(p.netU)} USDC</dd></dl>

<h2>recent decisions</h2>
<p class="muted">listings seen: ${esc(listings)}</p>
${decisions ? `<table><tr><th>listing</th><th class="n">price</th><th class="n">comp</th><th class="n">edge</th><th>decision</th></tr>${decisions}</table>` : '<p class="muted">nothing scored yet</p>'}

<h2>log</h2>
<pre class="log" id="log"></pre>
<p class="muted">${esc(runs)}</p>

<h2>how it decides</h2>
${decides(s.cfg).split('\n').map((l) => `<p>${esc(l)}</p>`).join('')}

${s.post ? `<h2>latest post</h2><p>${esc(s.post.text)}</p><p class="muted">${age(s.post.created_at)} ago</p>` : ''}
<footer><a href="/">site</a> · <a href="/api/state">state</a> · <a href="/health">health</a></footer>
</main>
<script>
const el=document.getElementById('log');const lines=[];
new EventSource('/events').onmessage=e=>{const j=JSON.parse(e.data);lines.push(j.ts.slice(11,19)+' '+j.step+' '+j.level+' '+j.msg);if(lines.length>200)lines.shift();el.textContent=lines.join('\\n');el.scrollTop=el.scrollHeight;};
</script></body></html>`;
}
