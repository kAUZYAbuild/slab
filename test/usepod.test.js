process.env.DB_PATH = ':memory:';
process.env.LIVE = '';
const test = (await import('node:test')).default;
const assert = (await import('node:assert/strict')).default;
const { decodeRequired, encodeSignature } = await import('../src/usepod.js');

test('decodes an x402 v2 accepts list and picks solana usdc', () => {
  const q = { x402_version: 2, quote_id: 'q1', accepts: [
    { scheme: 'exact', network: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp', pay_to: 'SOLADDR', asset: 'USDC', amount_microunits: 6, mode: 'cap-with-surplus-credit', body_hash: 'h', balance_hint: 'x' },
    { scheme: 'exact', network: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp', pay_to: 'SOLADDR', asset: 'SOL', amount_microunits: 60 },
    { scheme: 'exact', network: 'eip155:8453', payTo: '0xEVM', asset: '0x833', maxAmountRequired: '6' },
  ] };
  const a = decodeRequired(Buffer.from(JSON.stringify(q)).toString('base64'));
  assert.equal(a.quoteId, 'q1');
  assert.equal(a.payTo, 'SOLADDR');
  assert.equal(a.amountU, 6);
  assert.equal(a.asset, 'USDC');
  assert.match(a.network, /^solana:/);
  assert.equal(a.balanceScheme, true);
  assert.equal(a.bodyHash, 'h');
  const legacy = decodeRequired(Buffer.from(JSON.stringify({ quote_id: 'q2', pay_to: 'ADDR', amount: '12345', asset: 'USDC', network: 'solana' })).toString('base64'));
  assert.equal(legacy.amountU, 12345);
});

test('signature header round-trips', () => {
  const h = encodeSignature({ quote_id: 'q1', signature: 'sig' });
  assert.deepEqual(JSON.parse(Buffer.from(h, 'base64').toString()), { quote_id: 'q1', signature: 'sig' });
});
