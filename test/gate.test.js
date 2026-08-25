process.env.DB_PATH = ':memory:';
process.env.LIVE = '';
const test = (await import('node:test')).default;
const assert = (await import('node:assert/strict')).default;
const { book } = await import('../src/ledger.js');
const { authorize } = await import('../src/gate.js');
const { cfg } = await import('../src/config.js');
const U = 1_000_000;

test('each gate binds in turn', () => {
  book('open', [['Cash', 'USDC', 100 * U], ['Equity', 'USDC', -100 * U]], { ref: 'open:1' });
  assert.equal(authorize({ kind: 'buy', amountU: 30 * U, ref: 'b1', host: 'evil.example' }).gate, 'rules');
  assert.equal(authorize({ kind: 'buy', amountU: 0, ref: 'b1', host: 'api.collectorcrypt.com' }).gate, 'rules');
  assert.equal(authorize({ kind: 'buy', amountU: 30 * U, ref: '', host: 'api.collectorcrypt.com' }).gate, 'rules');
  assert.equal(authorize({ kind: 'buy', amountU: 200 * U, ref: 'b1', host: 'api.collectorcrypt.com' }).gate, 'caps');
  assert.equal(authorize({ kind: 'buy', amountU: 80 * U, ref: 'b1', host: 'api.collectorcrypt.com' }).gate, 'funds');
  const ok = authorize({ kind: 'buy', amountU: 30 * U, ref: 'b1', host: 'api.collectorcrypt.com' });
  assert.equal(ok.allowed, true);
});

test('daily cap is enforced from the ledger', () => {
  book('buy', [['Inventory', 'USDC', 290 * U], ['Cash', 'USDC', -290 * U]], { ref: 'buy:big' });
  book('open', [['Cash', 'USDC', 400 * U], ['Equity', 'USDC', -400 * U]], { ref: 'open:2' });
  const r = authorize({ kind: 'buy', amountU: 20 * U, ref: 'b2', host: 'api.collectorcrypt.com' });
  assert.equal(r.gate, 'caps');
  assert.match(r.reason, /daily cap/);
});

test('idempotent ref short-circuits', () => {
  const r = authorize({ kind: 'buy', amountU: 999 * U, ref: 'buy:big', host: 'nope' });
  assert.equal(r.allowed, true);
  assert.equal(r.reason, 'already booked');
});

test('llm and hosting caps', () => {
  assert.equal(authorize({ kind: 'llm', amountU: cfg.llmMaxCallU + 1, ref: 'l1', host: 'api.usepod.ai' }).gate, 'caps');
  assert.equal(authorize({ kind: 'llm', amountU: 1000, ref: 'l1', host: 'api.usepod.ai' }).allowed, true);
  assert.equal(authorize({ kind: 'hosting', amountU: cfg.hostingU + 1, ref: 'h1', host: 'solana' }).gate, 'caps');
  assert.equal(authorize({ kind: 'hosting', amountU: cfg.hostingU, ref: 'h1', host: 'solana' }).allowed, true);
  assert.equal(authorize({ kind: 'nope', amountU: 1, ref: 'n', host: 'solana' }).gate, 'rules');
});
