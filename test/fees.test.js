process.env.DB_PATH = ':memory:';
process.env.LIVE = '';
process.env.PAYOUT_SOURCES = 'FEEDIST';
const test = (await import('node:test')).default;
const assert = (await import('node:assert/strict')).default;
const { classify } = await import('../src/fees.js');

const ME = 'ME';
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const tx = ({ payer, pre, post, preTok = [], postTok = [], err = null }) => ({
  meta: { err, preBalances: pre, postBalances: post, preTokenBalances: preTok, postTokenBalances: postTok },
  transaction: { message: { accountKeys: [{ pubkey: payer }, { pubkey: ME }] } },
});
const tok = (accountIndex, owner, mint, amount, decimals = 6) => ({ accountIndex, owner, mint, uiTokenAmount: { amount, decimals } });

test('payout from a known distributor', () => {
  const c = classify(tx({ payer: 'FEEDIST', pre: [10, 0], post: [5, 5000] }), ME);
  assert.equal(c.kind, 'payout');
  assert.equal(c.lamports, 5000);
});

test('sol from an unknown sender is operator capital', () => {
  assert.equal(classify(tx({ payer: 'SOMEONE', pre: [10, 0], post: [5, 5000] }), ME).kind, 'sol_in');
});

test('usdc in with an nft leaving is a sale', () => {
  const c = classify(tx({
    payer: 'BUYER', pre: [1, 1], post: [1, 1],
    preTok: [tok(2, ME, USDC, '0'), tok(3, ME, 'NFT1', '1', 0)],
    postTok: [tok(2, ME, USDC, '49000000'), tok(3, ME, 'NFT1', '0', 0)],
  }), ME);
  assert.equal(c.kind, 'sale');
  assert.equal(c.usdcU, 49_000_000);
  assert.deepEqual(c.nftOut, ['NFT1']);
});

test('our own transaction is self, failed is failed', () => {
  assert.equal(classify(tx({ payer: ME, pre: [10, 0], post: [4, 0] }), ME).kind, 'self');
  assert.equal(classify(tx({ payer: 'X', pre: [1, 1], post: [1, 1], err: { x: 1 } }), ME).kind, 'failed');
});
