// The first real purchase: lowest-priced qualified candidate under FIRST_BUY_MAX_USD
// (default 50). Requires LIVE=1 and CONFIRM=yes. Then lists it. Kill the process
// between "signed" and "booked" once to exercise reconcile on the next boot.
import { cfg } from '../src/config.js';
import { db } from '../src/db.js';
import { tick } from '../src/loop.js';
import { reconcile } from '../src/reconcile.js';

if (cfg.paper || process.env.CONFIRM !== 'yes') { console.error('needs LIVE=1 CONFIRM=yes'); process.exit(1); }
const maxU = Math.round(Number(process.env.FIRST_BUY_MAX_USD ?? 50) * 1e6);
await reconcile();
db.prepare("UPDATE listings_seen SET status = 'skipped', skip_reason = 'first-buy cap' WHERE status = 'scored' AND price_u > ?").run(maxU);
await tick();
console.log(db.prepare('SELECT key, state, sig, amount_u FROM actions ORDER BY id DESC LIMIT 3').all());
console.log(db.prepare('SELECT nft_address, cost_u, state, list_price_u FROM positions ORDER BY id DESC LIMIT 3').all());
process.exit(0);
