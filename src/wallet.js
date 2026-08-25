// The agent's one hot wallet. Signing happens here and nowhere else.
import { Connection, Keypair, PublicKey, Transaction, TransactionInstruction, VersionedTransaction } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, getAssociatedTokenAddressSync, createTransferInstruction, createAssociatedTokenAccountIdempotentInstruction } from '@solana/spl-token';
import bs58 from 'bs58';
import { cfg } from './config.js';
import { log } from './log.js';

export const USDC_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
const MEMO_PROGRAM = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
export const connection = new Connection(cfg.rpcUrl, 'confirmed');

let keypair = null;
export function getKeypair() {
  if (keypair) return keypair;
  if (!cfg.privateKey) throw new Error('SLAB_PRIVATE_KEY not set');
  try {
    keypair = Keypair.fromSecretKey(bs58.decode(cfg.privateKey));
  } catch {
    keypair = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(cfg.privateKey)));
  }
  return keypair;
}
export const pubkey = () => getKeypair().publicKey.toBase58();
export const hasKey = () => Boolean(cfg.privateKey);

export async function getUSDCBalance() {
  const ata = getAssociatedTokenAddressSync(USDC_MINT, getKeypair().publicKey);
  try {
    const info = await connection.getTokenAccountBalance(ata);
    return Number(info.value.amount);
  } catch {
    return 0;
  }
}

export const getSOLBalance = () => connection.getBalance(getKeypair().publicKey);

// Returns the signature before anything is sent, so it can be persisted first.
export function signTx(base64) {
  const kp = getKeypair();
  const buf = Buffer.from(base64, 'base64');
  try {
    const tx = VersionedTransaction.deserialize(buf);
    tx.sign([kp]);
    return { sig: bs58.encode(tx.signatures[0]), signedBase64: Buffer.from(tx.serialize()).toString('base64') };
  } catch {
    const tx = Transaction.from(buf);
    tx.partialSign(kp);
    return { sig: bs58.encode(tx.signature), signedBase64: tx.serialize({ requireAllSignatures: false }).toString('base64') };
  }
}

export const sendRaw = (signedBase64) => connection.sendRawTransaction(Buffer.from(signedBase64, 'base64'), { maxRetries: 3 });

export async function confirm(sig, timeoutMs = 90_000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const { value } = await connection.getSignatureStatuses([sig]);
    const s = value[0];
    if (s?.err) return 'failed';
    if (s && (s.confirmationStatus === 'confirmed' || s.confirmationStatus === 'finalized')) return 'ok';
    await new Promise((r) => setTimeout(r, 2000));
  }
  return 'expired';
}

export async function buildUSDCTransfer(to, amountU, memo = '') {
  if (!Number.isInteger(amountU) || amountU <= 0) throw new Error(`transfer amount ${amountU} is not a positive integer`);
  if (amountU > cfg.maxTransferU) throw new Error(`transfer ${amountU}u is over the per-tx cap ${cfg.maxTransferU}u`);
  const kp = getKeypair();
  const dest = new PublicKey(to);
  const fromAta = getAssociatedTokenAddressSync(USDC_MINT, kp.publicKey);
  const toAta = getAssociatedTokenAddressSync(USDC_MINT, dest, true);
  const tx = new Transaction().add(
    createAssociatedTokenAccountIdempotentInstruction(kp.publicKey, toAta, dest, USDC_MINT),
    createTransferInstruction(fromAta, toAta, kp.publicKey, BigInt(amountU)),
  );
  if (memo) tx.add(new TransactionInstruction({ keys: [], programId: MEMO_PROGRAM, data: Buffer.from(memo, 'utf8') }));
  const { blockhash } = await connection.getLatestBlockhash();
  tx.recentBlockhash = blockhash;
  tx.feePayer = kp.publicKey;
  tx.sign(kp);
  return { sig: bs58.encode(tx.signature), signedBase64: tx.serialize().toString('base64') };
}

async function rpc(method, params) {
  const res = await fetch(cfg.rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const j = await res.json();
  if (j.error) throw new Error(`rpc ${method}: ${j.error.message}`);
  return j.result;
}

export async function getTx(sig) {
  for (let i = 0; i < 5; i++) {
    const tx = await rpc('getTransaction', [sig, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0, commitment: 'confirmed' }]);
    if (tx) return tx;
    await new Promise((r) => setTimeout(r, 1500));
  }
  return null;
}

export const getSignatures = (address, opts = {}) => connection.getSignaturesForAddress(new PublicKey(address), { limit: 25, ...opts });

let dasWarned = false;
// DAS (Helius etc.) sees pNFT, cNFT and Core assets. Plain token accounts miss Core.
export async function ownedNfts() {
  const owner = pubkey();
  try {
    const out = await rpc('getAssetsByOwner', { ownerAddress: owner, page: 1, limit: 1000 });
    return (out?.items ?? []).filter((a) => !a.burnt).map((a) => a.id);
  } catch (e) {
    if (!dasWarned) { dasWarned = true; log('wallet', 'warn', `DAS getAssetsByOwner unavailable on this RPC (${e.message}); Core assets will not be seen`); }
  }
  const mints = [];
  for (const programId of [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID]) {
    const { value } = await connection.getParsedTokenAccountsByOwner(getKeypair().publicKey, { programId });
    for (const { account } of value) {
      const t = account.data.parsed.info.tokenAmount;
      if (t.decimals === 0 && t.amount === '1') mints.push(account.data.parsed.info.mint);
    }
  }
  return mints;
}
