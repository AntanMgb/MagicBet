import { AnchorProvider, Program, BN } from '@coral-xyz/anchor';
import { Connection, PublicKey, Transaction, TransactionInstruction } from '@solana/web3.js';
import { AnchorWallet } from '@solana/wallet-adapter-react';
import idl from './magicbet-idl.json';
import type { MarketAccount, BetAccount } from '../types';

export const PROGRAM_ID         = new PublicKey('4TcWHMB16WRQhG6ccTHdXUZdHthaQRXLWrhLdxbn825A');
export const DEVNET_RPC         = 'https://api.devnet.solana.com';
export const MAGIC_ROUTER       = 'https://devnet-router.magicblock.app';
export const DELEGATION_PROGRAM = new PublicKey('DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh');

const MAGIC_PROGRAM_ID = new PublicKey('Magic11111111111111111111111111111111111111');
const MAGIC_CONTEXT_ID = new PublicKey('MagicContext1111111111111111111111111111111');

function createCommitAndUndelegateInstruction(payer: PublicKey, accounts: PublicKey[]): TransactionInstruction {
  const data = Buffer.alloc(4);
  data.writeUInt32LE(2, 0);
  return new TransactionInstruction({
    keys: [
      { pubkey: payer,            isSigner: true,  isWritable: true },
      { pubkey: MAGIC_CONTEXT_ID, isSigner: false, isWritable: true },
      ...accounts.map(a => ({ pubkey: a, isSigner: false, isWritable: false })),
    ],
    programId: MAGIC_PROGRAM_ID,
    data,
  });
}

export function getProgram(wallet: AnchorWallet, connection: Connection) {
  const provider = new AnchorProvider(connection, wallet, { commitment: 'confirmed' });
  return new Program(idl as never, provider);
}

export function getMarketPda(marketId: bigint): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from('market'), Buffer.from(new BN(marketId.toString()).toArrayLike(Buffer, 'le', 8))],
    PROGRAM_ID
  );
  return pda;
}

export function getBetPda(marketId: bigint, user: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from('bet'),
      Buffer.from(new BN(marketId.toString()).toArrayLike(Buffer, 'le', 8)),
      user.toBuffer(),
    ],
    PROGRAM_ID
  );
  return pda;
}

export async function fetchAllMarkets(connection: Connection): Promise<MarketAccount[]> {
  const provider = new AnchorProvider(connection, {} as AnchorWallet, { commitment: 'confirmed' });
  const program = new Program(idl as never, provider);
  try {
    const markets = await (program.account as any).market.all();
    return markets.map((m: any) => ({
      marketId:       m.account.marketId.toString(),
      creator:        m.account.creator.toString(),
      question:       m.account.question,
      deadline:       m.account.deadline.toNumber(),
      pythFeed:       m.account.pythFeed?.toString() ?? null,
      targetPrice:    m.account.targetPrice?.toString() ?? null,
      marketType:     m.account.marketType,
      resolved:       m.account.resolved,
      winningOutcome: m.account.winningOutcome,
      totalYes:       m.account.totalYes.toString(),
      totalNo:        m.account.totalNo.toString(),
      publicKey:      m.publicKey.toString(),
    }));
  } catch {
    return [];
  }
}

export async function fetchUserBet(
  connection: Connection,
  marketId: bigint,
  user: PublicKey
): Promise<BetAccount | null> {
  const provider = new AnchorProvider(connection, {} as AnchorWallet, { commitment: 'confirmed' });
  const program = new Program(idl as never, provider);
  const betPda = getBetPda(marketId, user);
  try {
    const bet = await (program.account as any).bet.fetch(betPda);
    return {
      user:     bet.user.toString(),
      marketId: bet.marketId.toString(),
      outcome:  bet.outcome,
      amount:   bet.amount.toString(),
      claimed:  bet.claimed,
      publicKey: betPda.toString(),
    };
  } catch {
    return null;
  }
}

export function lamportsToSol(lamports: string | number): number {
  return Number(lamports) / 1e9;
}

export function solToLamports(sol: number): BN {
  return new BN(Math.floor(sol * 1e9));
}

export function formatDeadline(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleString();
}

export function isExpired(deadline: number): boolean {
  return Date.now() / 1000 > deadline;
}

/**
 * Commit + undelegate a bet PDA from the ER back to L1.
 * Must be called before claim_winnings when the bet was delegated.
 */
export async function undelegateBet(wallet: AnchorWallet, betPda: PublicKey): Promise<void> {
  const erConn = new Connection(MAGIC_ROUTER, 'confirmed');
  const l1Conn = new Connection(DEVNET_RPC,   'confirmed');

  const ix = createCommitAndUndelegateInstruction(wallet.publicKey, [betPda]);
  const tx = new Transaction();
  tx.add(ix);
  const { blockhash } = await erConn.getLatestBlockhash('confirmed');
  tx.recentBlockhash = blockhash;
  tx.feePayer = wallet.publicKey;

  const signed = await wallet.signTransaction(tx);
  await erConn.sendRawTransaction(signed.serialize(), { skipPreflight: true });

  // Poll L1 until ownership returns to our program (max 30s)
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 500));
    const info = await l1Conn.getAccountInfo(betPda);
    if (info && !info.owner.equals(DELEGATION_PROGRAM)) return;
  }
  throw new Error('Undelegation timed out. The bet is still in the TEE. Please wait a moment and try again.');
}
