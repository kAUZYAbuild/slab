import { cfg, preflight, usd } from './config.js';
import { db } from './db.js';
import { book, hasRef, balance } from './ledger.js';
import { log } from './log.js';
import { startServer } from './server.js';
import { start, wallet } from './loop.js';

const missing = preflight();
if (missing.length) {
  console.error('slab: missing env:\n  ' + missing.join('\n  ') + '\nCopy .env.example to .env and fill these in.');
  process.exit(1);
}

if (cfg.paper && !hasRef('open:paper')) {
  book('open', [['Cash', 'USDC', cfg.paperBankrollU], ['Equity', 'USDC', -cfg.paperBankrollU]], { ref: 'open:paper', memo: 'paper bankroll' });
}

log('boot', 'info', `slab ${cfg.paper ? 'paper' : 'LIVE'} | wallet ${wallet()} | cash ${usd(balance('Cash'))} USDC | db ${cfg.dbPath}`);
startServer();
start();

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    log('boot', 'info', `${sig}: closing`);
    db.close();
    process.exit(0);
  });
}
