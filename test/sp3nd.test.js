process.env.DB_PATH = ':memory:';
process.env.LIVE = '';
const { Keypair, Transaction, PublicKey } = await import('@solana/web3.js');
const kp = Keypair.generate();
process.env.SLAB_PRIVATE_KEY = JSON.stringify(Array.from(kp.secretKey));
const test = (await import('node:test')).default;
const assert = (await import('node:assert/strict')).default;
const { pick, atomic, paymentTransaction, paymentHeader } = await import('../src/sp3nd.js');

const feePayer = Keypair.generate().publicKey.toBase58();
const payTo = Keypair.generate().publicKey.toBase58();
const q402 = { x402Version: 2, accepts: [
  { scheme: 'exact', network: 'eip155:8453', payTo: '0xabc', asset: '0x833', maxAmountRequired: '10810000' },
  { scheme: 'exact', network: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp', payTo, asset: 'USDC', maxAmountRequired: '10.81', extra: { order_id: 'o1', order_number: 'ORD-1', feePayer } },
] };

test('picks the solana accept and reads atomic amounts either way', () => {
  const q = pick(q402);
  assert.equal(q.payTo, payTo);
  assert.equal(q.amountU, 10_810_000);
  assert.equal(q.feePayer, feePayer);
  assert.equal(q.memo, 'SP3ND Order: ORD-1');
  assert.equal(atomic('10810000'), 10_810_000);
  assert.equal(pick({ accepts: [] }), null);
});

test('payment transaction is signed by us, fee payer is sp3nd, memo present, nothing broadcast', () => {
  const q = pick(q402);
  const blockhash = Keypair.generate().publicKey.toBase58();
  const tx = Transaction.from(Buffer.from(paymentTransaction(q, blockhash), 'base64'));
  assert.equal(tx.feePayer.toBase58(), feePayer);
  assert.equal(tx.instructions.length, 3);
  assert.equal(Buffer.from(tx.instructions[2].data).toString(), 'SP3ND Order: ORD-1');
  const ours = tx.signatures.find((s) => s.publicKey.equals(kp.publicKey));
  const theirs = tx.signatures.find((s) => s.publicKey.equals(new PublicKey(feePayer)));
  assert.ok(ours?.signature, 'our signature present');
  assert.equal(theirs?.signature, null, 'fee payer not signed yet');
  const header = JSON.parse(Buffer.from(paymentHeader(q, 'abc'), 'base64').toString());
  assert.deepEqual(header, { x402Version: 2, scheme: 'exact', network: q.network, payload: { transaction: 'abc' } });
});
