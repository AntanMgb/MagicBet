import { NextResponse } from 'next/server';
import { Connection, Keypair, PublicKey, Transaction, TransactionInstruction } from '@solana/web3.js';
import { BN } from '@coral-xyz/anchor';

const MAGIC_PROGRAM_ID = new PublicKey('Magic11111111111111111111111111111111111111');
const MAGIC_CONTEXT_ID = new PublicKey('MagicContext1111111111111111111111111111111');

// Override SDK version: pass accounts as isWritable:true so ER can commit state
function createCommitAndUndelegateInstruction(payer: PublicKey, accounts: PublicKey[]): TransactionInstruction {
  const keys = [
    { pubkey: payer,            isSigner: true,  isWritable: true },
    { pubkey: MAGIC_CONTEXT_ID, isSigner: false, isWritable: true },
    ...accounts.map(a => ({ pubkey: a, isSigner: false, isWritable: true })),
  ];
  const data = Buffer.alloc(4);
  data.writeUInt32LE(2, 0);
  return new TransactionInstruction({ keys, programId: MAGIC_PROGRAM_ID, data });
}

const MAGIC_ROUTER       = 'https://devnet-router.magicblock.app';
const DEVNET_RPC         = 'https://api.devnet.solana.com';
const DELEGATION_PROGRAM = new PublicKey('DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh');
const PROGRAM_ID         = new PublicKey('4TcWHMB16WRQhG6ccTHdXUZdHthaQRXLWrhLdxbn825A');

function loadKeypair(): Keypair {
  const raw = process.env.SOLANA_KEYPAIR;
  if (!raw) throw new Error('SOLANA_KEYPAIR not set');
  return Keypair.fromSecretKey(new Uint8Array(JSON.parse(raw)));
}

function getBetPda(marketId: bigint, user: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from('bet'), Buffer.from(new BN(marketId.toString()).toArrayLike(Buffer, 'le', 8)), user.toBuffer()],
    PROGRAM_ID
  );
  return pda;
}

export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const { marketId, userPubkey } = await req.json();
    if (!marketId || !userPubkey) return NextResponse.json({ error: 'Missing params' }, { status: 400 });

    const user    = new PublicKey(userPubkey);
    const betPda  = getBetPda(BigInt(marketId), user);
    const l1Conn  = new Connection(DEVNET_RPC, 'confirmed');

    // Check if already back on L1
    const info = await l1Conn.getAccountInfo(betPda, 'confirmed');
    if (!info) return NextResponse.json({ error: 'Bet account not found' }, { status: 404 });
    if (!info.owner.equals(DELEGATION_PROGRAM)) {
      return NextResponse.json({ ok: true, alreadyOnL1: true });
    }

    // Server sends commitAndUndelegate to ER — no user signature needed
    const payer  = loadKeypair();
    const erConn = new Connection(MAGIC_ROUTER, 'confirmed');
    const ix     = createCommitAndUndelegateInstruction(payer.publicKey, [betPda]);
    const tx     = new Transaction();
    tx.add(ix);
    const { blockhash } = await erConn.getLatestBlockhash('confirmed');
    tx.recentBlockhash = blockhash;
    tx.feePayer = payer.publicKey;
    tx.sign(payer);

    const sig = await erConn.sendRawTransaction(tx.serialize(), { skipPreflight: true });
    console.log('[SERVER UNDELEGATE] sent to ER:', sig);

    // Poll L1 until bet returns (max 60s)
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 2000));
      const updated = await l1Conn.getAccountInfo(betPda, 'confirmed');
      if (updated && !updated.owner.equals(DELEGATION_PROGRAM)) {
        console.log('[SERVER UNDELEGATE] bet back on L1');
        return NextResponse.json({ ok: true });
      }
    }

    return NextResponse.json({ error: 'Undelegation timeout — bet did not return to L1 in 60s' }, { status: 504 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message }, { status: 500 });
  }
}
