import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { cfg } from './config.js';
import { db, runs, counterGet, kvGet, kvSet, now } from './db.js';
import { pnl, imbalance, transactions } from './ledger.js';
import { allPositions } from './inventory.js';
import { recentActions } from './act.js';
import { subscribe, recent, log } from './log.js';
import { status as loopStatus, wallet } from './loop.js';
import { render, decides } from './dashboard.js';

const decisionsStmt = db.prepare(`SELECT nft_address, item_name, price_u, status, skip_reason, score_json, seen_at
  FROM listings_seen WHERE status IN ('scored','skipped','bought') ORDER BY seen_at DESC LIMIT 40`);
const countStmt = db.prepare('SELECT status, COUNT(*) AS n FROM listings_seen GROUP BY status');
const compStmt = db.prepare('SELECT price_u, confidence FROM comps WHERE card_key = ?');
const postStmt = db.prepare('SELECT text, created_at FROM posts ORDER BY id DESC LIMIT 1');
const llmStmt = db.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(paid_u), 0) AS u FROM llm_calls WHERE state = 'done' AND created_at >= ?");

export function state() {
  const positions = allPositions().map((p) => ({ ...p, comp: compStmt.get(p.card_key) ?? null }));
  const listings = Object.fromEntries(countStmt.all().map((r) => [r.status, r.n]));
  const llmToday = llmStmt.get(now().slice(0, 10));
  const rulesCfg = {
    minTicketU: cfg.minTicketU, maxTicketU: cfg.maxTicketU, minEdge: cfg.minEdge, maxPosPct: cfg.maxPosPct, maxOpen: cfg.maxOpen,
    dailyCapU: cfg.dailyCapU, minCashReserveU: cfg.minCashReserveU, haircut: cfg.haircut, ccFee: cfg.ccFee, sellMargin: cfg.sellMargin,
    repriceDays: cfg.repriceDays, repriceStep: cfg.repriceStep, stuckDays: cfg.stuckDays, hostingU: cfg.hostingU,
    nonEnglishPenalty: cfg.nonEnglishPenalty, promoPenalty: cfg.promoPenalty, medPenalty: cfg.medPenalty, floorUndercut: cfg.floorUndercut,
  };
  return {
    rules: decides(rulesCfg),
    paper: cfg.paper,
    wallet: wallet(),
    model: cfg.usepodModel || null,
    tokenMint: cfg.tokenMint || null,
    loop: loopStatus(),
    pnl: pnl(),
    imbalance: imbalance(),
    driftAck: kvGet('drift_ack'),
    driftFlag: kvGet('drift_flag'),
    positions,
    decisions: decisionsStmt.all().map((d) => ({ ...d, score: d.score_json ? JSON.parse(d.score_json) : null })),
    listings,
    actions: recentActions(50),
    transactions: transactions(30),
    runs: runs(),
    counters: { pptCredits: counterGet('ppt_credits'), pptBudget: cfg.pptDailyBudget, llmCallsToday: llmToday.n, llmSpentTodayU: llmToday.u },
    post: postStmt.get() ?? null,
    cfg: rulesCfg,
  };
}

const json = (res, code, body) => {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
};

function sse(req, res) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  for (const e of recent(100)) res.write(`data: ${JSON.stringify(e)}\n\n`);
  const off = subscribe((e) => res.write(`data: ${JSON.stringify(e)}\n\n`));
  const hb = setInterval(() => res.write(': hb\n\n'), 15_000);
  req.on('close', () => { off(); clearInterval(hb); });
}

const SITE = new URL('../site/', import.meta.url).pathname;
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.mp4': 'video/mp4', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };

async function serveStatic(pathname, req, res) {
  const rel = normalize(pathname === '/' ? 'index.html' : pathname.slice(1));
  if (rel.startsWith('..')) return json(res, 404, { error: 'not found' });
  const file = join(SITE, rel);
  const headers = { 'Content-Type': MIME[extname(rel)] ?? 'application/octet-stream', 'Cache-Control': rel.startsWith('assets/') ? 'public, max-age=86400' : 'no-cache', 'Accept-Ranges': 'bytes' };
  let size;
  try {
    size = (await stat(file)).size;
  } catch {
    return json(res, 404, { error: 'not found' });
  }
  // Chrome only plays <video> from servers that honour byte ranges.
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
  if (range) {
    const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (start >= size || start > end) {
      res.writeHead(416, { 'Content-Range': `bytes */${size}` });
      return res.end();
    }
    res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1 });
    return createReadStream(file, { start, end }).pipe(res);
  }
  if (size > 1_000_000) {
    res.writeHead(200, { ...headers, 'Content-Length': size });
    return createReadStream(file).pipe(res);
  }
  res.writeHead(200, headers);
  res.end(await readFile(file));
}

export function startServer() {
  const server = http.createServer((req, res) => {
    const { pathname } = new URL(req.url, 'http://x');
    if (req.method === 'GET' && pathname === '/ops') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(render(state()));
    }
    if (req.method === 'GET' && pathname === '/api/state') return json(res, 200, state());
    if (req.method === 'GET' && pathname === '/events') return sse(req, res);
    if (req.method === 'GET' && pathname === '/health') {
      const imb = imbalance();
      const ok = Object.values(imb).every((v) => v === 0);
      return json(res, ok ? 200 : 500, { ok, paper: cfg.paper, lastTickAt: loopStatus().lastTickAt, imbalance: imb });
    }
    if (req.method === 'POST' && pathname === '/api/ack-drift') {
      if (!cfg.adminToken || req.headers.authorization !== `Bearer ${cfg.adminToken}`) return json(res, 401, { error: 'bad token' });
      kvSet('drift_ack', now());
      kvSet('drift_flag', '');
      log('server', 'info', 'drift acknowledged by operator');
      return json(res, 200, { ok: true });
    }
    if (req.method === 'GET') return serveStatic(pathname, req, res);
    json(res, 404, { error: 'not found' });
  });
  server.listen(cfg.port, () => log('server', 'info', `listening on :${cfg.port}`));
  return server;
}
