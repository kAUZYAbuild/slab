process.env.DB_PATH = ':memory:';
process.env.LIVE = '';
const test = (await import('node:test')).default;
const assert = (await import('node:assert/strict')).default;
const { decodeRequired, encodeSignature } = await import('../src/usepod.js');

test('decodes a payment-required header with either naming style', () => {
  const a = decodeRequired(Buffer.from(JSON.stringify({ quote_id: 'q1', pay_to: 'ADDR', amount: '12345', asset: 'USDC', network: 'solana' })).toString('base64'));
  assert.equal(a.quoteId, 'q1');
  assert.equal(a.payTo, 'ADDR');
  assert.equal(a.amountU, 12345);
  const b = decodeRequired(Buffer.from(JSON.stringify({ quoteId: 'q2', payTo: 'ADDR', maxAmountRequired: '0.0123', asset: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' })).toString('base64'));
  assert.equal(b.amountU, 12300);
  assert.equal(b.network, 'solana');
});

test('signature header round-trips', () => {
  const h = encodeSignature({ quote_id: 'q1', signature: 'sig' });
  assert.deepEqual(JSON.parse(Buffer.from(h, 'base64').toString()), { quote_id: 'q1', signature: 'sig' });
});
