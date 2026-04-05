import { NextResponse } from 'next/server';
import { Connection, Keypair, PublicKey, SystemProgram, Transaction } from '@solana/web3.js';
import { AnchorProvider, Program, BN } from '@coral-xyz/anchor';
import nacl from 'tweetnacl';
import idl from '@/lib/magicbet-idl.json';

const DEVNET_RPC = 'https://api.devnet.solana.com';
const PROGRAM_ID = new PublicKey('4TcWHMB16WRQhG6ccTHdXUZdHthaQRXLWrhLdxbn825A');

// Wallets allowed to trigger withdrawal
const AUTHORIZED_WALLETS = new Set([
  'BwSn5zeYaTiyNj5X2S7UHKQnr5JxBYSrqkTY7sA1c37',
]);

function loadKeypair(): Keypair {
  const raw = process.env.SOLANA_KEYPAIR;
  if (!raw) throw new Error('SOLANA_KEYPAIR env variable not set');
  return Keypair.fromSecretKey(new Uint8Array(JSON.parse(raw)));
}

function getMarketPda(marketId: bigint): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from('market'), Buffer.from(new BN(marketId.toString()).toArrayLike(Buffer, 'le', 8))],
    PROGRAM_ID
  );
  return pda;
}

export async function POST(req: Request) {
  try {
    const { marketId, walletAddress, signature } = await req.json();
    if (!marketId) return NextResponse.json({ error: 'marketId required' }, { status: 400 });
    if (!walletAddress || !signature) return NextResponse.json({ error: 'walletAddress and signature required' }, { status: 400 });

    // 1. Verify signature — user signed "withdraw:<marketId>"
    const message = new TextEncoder().encode(`withdraw:${marketId}`);
    const sigBytes = Buffer.from(signature, 'base64');
    const pubKeyBytes = new PublicKey(walletAddress).toBytes();
    const valid = nacl.sign.detached.verify(message, sigBytes, pubKeyBytes);
    if (!valid) return NextResponse.json({ error: 'Invalid signature' }, { status: 403 });

    // 2. Check allowlist
    if (!AUTHORIZED_WALLETS.has(walletAddress)) {
      return NextResponse.json({ error: 'Unauthorized wallet' }, { status: 403 });
    }

    const connection = new Connection(DEVNET_RPC, 'confirmed');
    const payer = loadKeypair();
    const wallet = {
      publicKey: payer.publicKey,
      signTransaction: async (tx: any) => { tx.partialSign(payer); return tx; },
      signAllTransactions: async (txs: any[]) => { txs.forEach(tx => tx.partialSign(payer)); return txs; },
    };
    const provider = new AnchorProvider(connection, wallet as any, { commitment: 'confirmed' });
    const program = new Program(idl as never, provider);
    const marketPda = getMarketPda(BigInt(marketId));

    // 3. Fetch market to know losing side amount
    const marketAccount = await (program.account as any).market.fetch(marketPda);
    const losingAmount = marketAccount.winningOutcome === 1
      ? Number(marketAccount.totalNo)
      : Number(marketAccount.totalYes);

    if (losingAmount === 0) {
      return NextResponse.json({ error: 'Nothing to withdraw' }, { status: 400 });
    }

    // 4. Check if on-chain withdrawal already happened (market may have been drained in a previous call)
    const marketInfo = await connection.getAccountInfo(marketPda);
    const marketLamports = marketInfo?.lamports ?? 0;
    const rentExempt = await connection.getMinimumBalanceForRentExemption(marketInfo?.data.length ?? 300);
    const available = marketLamports - rentExempt;

    if (available >= losingAmount) {
      // On-chain withdrawal not yet done — execute it (SOL goes to server keypair = market.creator)
      await (program.methods as any)
        .withdrawFees(new BN(marketId))
        .accounts({ creator: payer.publicKey, market: marketPda, systemProgram: SystemProgram.programId })
        .rpc();
    }
    // else: already withdrawn on-chain previously, SOL is sitting in server keypair — skip and just transfer

    // 5. Forward SOL from server keypair to the caller's wallet
    const recipient = new PublicKey(walletAddress);
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
    const transferTx = new Transaction();
    transferTx.recentBlockhash = blockhash;
    transferTx.feePayer = payer.publicKey;
    transferTx.add(
      SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: recipient, lamports: losingAmount })
    );
    transferTx.sign(payer);
    const sig = await connection.sendRawTransaction(transferTx.serialize(), { skipPreflight: false });
    await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');

    return NextResponse.json({ ok: true, transferred: losingAmount });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Failed' }, { status: 500 });
  }
}
