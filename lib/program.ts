import { AnchorProvider, Program, BN } from '@coral-xyz/anchor';
import { Connection, PublicKey, Transaction } from '@solana/web3.js';
import { AnchorWallet } from '@solana/wallet-adapter-react';
import {
  createCommitAndUndelegateInstruction,
  GetCommitmentSignature,
} from '@magicblock-labs/ephemeral-rollups-sdk';
import idl from './magicbet-idl.json';
import type { MarketAccount, BetAccount } from '../types';

export const PROGRAM_ID         = new PublicKey('4TcWHMB16WRQhG6ccTHdXUZdHthaQRXLWrhLdxbn825A');
export const DEVNET_RPC         = 'https://api.devnet.solana.com';
export const MAGIC_ROUTER       = 'https://devnet-router.magicblock.app';
export const DELEGATION_PROGRAM = new PublicKey('DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh');


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
 * Uses GetCommitmentSignature to properly wait for the L1 commit to land.
 * Times out after 60s to avoid hanging indefinitely.
 */
export async function undelegateBet(wallet: AnchorWallet, betPda: PublicKey): Promise<void> {
  const TIMEOUT_MS = 60_000;

  const withTimeout = <T>(promise: Promise<T>, ms: number, label: string): Promise<T> => {
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout: ${label} took longer than ${ms / 1000}s`)), ms)
    );
    return Promise.race([promise, timeout]);
  };

  const erConn = new Connection(MAGIC_ROUTER, 'confirmed');

  const ix = createCommitAndUndelegateInstruction(wallet.publicKey, [betPda]);
  const tx = new Transaction();
  tx.add(ix);
  const { blockhash } = await withTimeout(
    erConn.getLatestBlockhash('confirmed'), TIMEOUT_MS, 'getLatestBlockhash'
  );
  tx.recentBlockhash = blockhash;
  tx.feePayer = wallet.publicKey;
  const signed = await wallet.signTransaction(tx);
  const erSig = await withTimeout(
    erConn.sendRawTransaction(signed.serialize(), { skipPreflight: true }), TIMEOUT_MS, 'sendRawTransaction'
  );
  console.log('[UNDELEGATE] ER tx sent:', erSig);

  // Skip erConn.confirmTransaction — ER doesn't support standard WebSocket subscriptions.
  // GetCommitmentSignature polls until the ER commits to L1, which is sufficient.
  const l1CommitSig = await withTimeout(
    GetCommitmentSignature(erSig, erConn), TIMEOUT_MS, 'GetCommitmentSignature'
  );
  console.log('[UNDELEGATE] L1 commit sig:', l1CommitSig);

  const l1Conn = new Connection(DEVNET_RPC, 'confirmed');
  const { blockhash: l1Bh, lastValidBlockHeight: l1Lbh } = await l1Conn.getLatestBlockhash('confirmed');
  await withTimeout(
    l1Conn.confirmTransaction({ signature: l1CommitSig, blockhash: l1Bh, lastValidBlockHeight: l1Lbh }, 'confirmed'),
    TIMEOUT_MS, 'confirmTransaction L1'
  );
  console.log('[UNDELEGATE] L1 commit confirmed — bet owned by program again');
}
