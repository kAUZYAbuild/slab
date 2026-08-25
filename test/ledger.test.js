process.env.DB_PATH = ':memory:';
process.env.LIVE = '';
const test = (await import('node:test')).default;
const assert = (await import('node:assert/strict')).default;
const { book, balance, hasRef, imbalance, pnl, spentSince, transactions } = await import('../src/ledger.js');

test('balanced postings and reads', () => {
  book('open', [['Cash', 'USDC', 500], ['Equity', 'USDC', -500]], { ref: 'open:1' });
  book('buy', [['Inventory', 'USDC', 120], ['Cash', 'USDC', -120]], { ref: 'buy:a' });
  book('sale', [['Cash', 'USDC', 147], ['Expense:PlatformFee', 'USDC', 3], ['Revenue:Sales', 'USDC', -150], ['COGS', 'USDC', 120], ['Inventory', 'USDC', -120]], { ref: 'sale:a' });
  book('payout', [['Cash', 'SOL', 1000], ['Revenue:Fees', 'SOL', -1000]], { ref: 'payout:x' });
  book('swap', [['Cash', 'SOL', -1000], ['FX', 'SOL', 1000], ['Cash', 'USDC', 90], ['FX', 'USDC', -90]], { ref: 'swap:y' });
  assert.equal(balance('Cash'), 617);
  assert.equal(balance('Cash', 'SOL'), 0);
  assert.equal(balance('Inventory'), 0);
  assert.deepEqual(imbalance(), { USDC: 0, SOL: 0 });
  const p = pnl();
  assert.equal(p.revenueSalesU, 150);
  assert.equal(p.cogsU, 120);
  assert.equal(p.expenses.platformFee, 3);
  assert.equal(p.swappedToUsdcU, 90);
  assert.equal(p.netU, 150 + 90 - 120 - 3);
  assert.ok(hasRef('buy:a'));
  assert.equal(hasRef(''), false);
  assert.equal(spentSince('buy', '2000-01-01'), 120);
  assert.equal(transactions(2).length, 2);
});

test('rejects unbalanced, non-integer, unknown currency, duplicate ref', () => {
  assert.throws(() => book('x', [['Cash', 'USDC', 5], ['Equity', 'USDC', -4]]), /unbalanced/);
  assert.throws(() => book('x', [['Cash', 'USDC', 5], ['Cash', 'SOL', -5]]), /unbalanced/);
  assert.throws(() => book('x', [['Cash', 'USDC', 1.5], ['Equity', 'USDC', -1.5]]), /integer/);
  assert.throws(() => book('x', [['Cash', 'EUR', 1], ['Equity', 'EUR', -1]]), /currency/);
  assert.throws(() => book('x', []), /no entries/);
  assert.throws(() => book('buy', [['Inventory', 'USDC', 1], ['Cash', 'USDC', -1]], { ref: 'buy:a' }), /already booked/);
  assert.equal(balance('Cash'), 617);
});
