import { AnchorProvider, Program, BN } from '@coral-xyz/anchor';
import { Connection, PublicKey, Transaction } from '@solana/web3.js';
import { AnchorWallet } from '@solana/wallet-adapter-react';
import {
  createCommitAndUndelegateInstruction as _createCommitAndUndelegate,
} from '@magicblock-labs/ephemeral-rollups-sdk';
import { TransactionInstruction } from '@solana/web3.js';

const MAGIC_PROGRAM_ID  = new PublicKey('Magic11111111111111111111111111111111111111');
const MAGIC_CONTEXT_ID  = new PublicKey('MagicContext1111111111111111111111111111111');

// SDK passes accounts as isWritable:false — ER can't commit writable state.
// Override with isWritable:true so the magic program can write committed data.
function createCommitAndUndelegateInstruction(payer: PublicKey, accounts: PublicKey[]): TransactionInstruction {
  const keys = [
    { pubkey: payer,           isSigner: true,  isWritable: true },
    { pubkey: MAGIC_CONTEXT_ID, isSigner: false, isWritable: true },
    ...accounts.map(a => ({ pubkey: a, isSigner: false, isWritable: true })),
  ];
  const data = Buffer.alloc(4);
  data.writeUInt32LE(2, 0);
  return new TransactionInstruction({ keys, programId: MAGIC_PROGRAM_ID, data });
}
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

export function getBetCounterPda(marketId: bigint, user: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from('bet_counter'),
      Buffer.from(new BN(marketId.toString()).toArrayLike(Buffer, 'le', 8)),
      user.toBuffer(),
    ],
    PROGRAM_ID
  );
  return pda;
}

export function getMarketPda(marketId: bigint): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from('market'), Buffer.from(new BN(marketId.toString()).toArrayLike(Buffer, 'le', 8))],
    PROGRAM_ID
  );
  return pda;
}

export function getBetRecordPda(marketId: bigint, user: PublicKey, betIndex: bigint): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from('bet_record'),
      Buffer.from(new BN(marketId.toString()).toArrayLike(Buffer, 'le', 8)),
      user.toBuffer(),
      Buffer.from(new BN(betIndex.toString()).toArrayLike(Buffer, 'le', 8)),
    ],
    PROGRAM_ID
  );
  return pda;
}

export function getClaimRecordPda(marketId: bigint, user: PublicKey, betIndex: bigint): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from('claim'),
      Buffer.from(new BN(marketId.toString()).toArrayLike(Buffer, 'le', 8)),
      user.toBuffer(),
      Buffer.from(new BN(betIndex.toString()).toArrayLike(Buffer, 'le', 8)),
    ],
    PROGRAM_ID
  );
  return pda;
}

export function getBetPda(marketId: bigint, user: PublicKey, betIndex: bigint): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from('bet'),
      Buffer.from(new BN(marketId.toString()).toArrayLike(Buffer, 'le', 8)),
      user.toBuffer(),
      Buffer.from(new BN(betIndex.toString()).toArrayLike(Buffer, 'le', 8)),
    ],
    PROGRAM_ID
  );
  return pda;
}

export async function fetchUserBetCount(connection: Connection, marketId: bigint, user: PublicKey): Promise<number> {
  const provider = new AnchorProvider(connection, {} as AnchorWallet, { commitment: 'confirmed' });
  const program = new Program(idl as never, provider);
  const counterPda = getBetCounterPda(marketId, user);
  try {
    const counter = await (program.account as any).betCounter.fetch(counterPda);
    return Number(counter.count);
  } catch {
    return 0;
  }
}

export async function fetchUserBetRecords(
  connection: Connection,
  marketId: bigint,
  user: PublicKey
): Promise<BetAccount[]> {
  const count = await fetchUserBetCount(connection, marketId, user);
  const provider = new AnchorProvider(connection, {} as AnchorWallet, { commitment: 'confirmed' });
  const program = new Program(idl as never, provider);
  const results: BetAccount[] = [];
  for (let i = 0; i < count; i++) {
    const pda = getBetRecordPda(marketId, user, BigInt(i));
    try {
      const rec = await (program.account as any).betRecord.fetch(pda);
      results.push({
        user:      rec.user.toString(),
        marketId:  rec.marketId.toString(),
        outcome:   rec.outcome,
        amount:    rec.amount.toString(),
        claimed:   false,
        publicKey: pda.toString(),
        betIndex:  Number(rec.betIndex),
      });
    } catch {}
  }
  return results;
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
  user: PublicKey,
  betIndex: bigint = BigInt(0)
): Promise<BetAccount | null> {
  const provider = new AnchorProvider(connection, {} as AnchorWallet, { commitment: 'confirmed' });
  const program = new Program(idl as never, provider);
  const betPda = getBetPda(marketId, user, betIndex);
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

// BetRecord discriminator — pre-computed base58 of [144,217,102,109,200,164,66,178]
const BET_RECORD_DISC_B58 = 'REDhHV8bmdT';

/** Read a little-endian u64 from a Uint8Array at the given offset. Returns BigInt. */
function readU64LE(data: Uint8Array, offset: number): bigint {
  const view = new DataView(data.buffer, data.byteOffset + offset, 8);
  return view.getBigUint64(0, true);
}

export async function fetchAllUserBets(connection: Connection, user: PublicKey): Promise<BetAccount[]> {
  try {
    // Raw getProgramAccounts — IDL has no field schema for BetRecord so Anchor can't decode it
    const raw = await connection.getProgramAccounts(PROGRAM_ID, {
      filters: [
        { memcmp: { offset: 0, bytes: BET_RECORD_DISC_B58 } }, // discriminator
        { memcmp: { offset: 8, bytes: user.toBase58() } },     // user pubkey at offset 8
      ],
    });

    const results: BetAccount[] = [];
    for (const { pubkey, account } of raw) {
      try {
        const d = account.data as Uint8Array;
        // Two on-chain layouts:
        // OLD 58-byte: 8(disc)+32(user)+8(market_id)+1(outcome)+8(amount)+1(claimed)
        // NEW 66-byte: 8(disc)+32(user)+8(market_id)+8(bet_index)+1(outcome)+8(amount)+1(bump)
        const marketId = readU64LE(d, 40).toString();
        let outcome: 1 | 2;
        let amount: string;
        let betIndex = 0;
        let claimed = false;

        if (d.length >= 66) {
          betIndex = Number(readU64LE(d, 48));
          outcome  = d[56] as 1 | 2;
          amount   = readU64LE(d, 57).toString();
        } else {
          outcome = d[48] as 1 | 2;
          amount  = readU64LE(d, 49).toString();
          claimed = d.length > 57 ? d[57] === 1 : false;
          const mid = BigInt(marketId);
          for (let bi = 0; bi < 20; bi++) {
            if (getBetRecordPda(mid, user, BigInt(bi)).equals(pubkey)) { betIndex = bi; break; }
          }
        }

        results.push({ user: user.toString(), marketId, outcome, amount, claimed, betIndex, publicKey: pubkey.toString() } as BetAccount);
      } catch (e) {
        console.warn('[fetchAllUserBets] skip account', pubkey.toString(), e);
      }
    }
    return results;
  } catch (e) {
    console.error('[fetchAllUserBets] error:', e);
    return [];
  }
}

/**
 * Commit + undelegate a bet PDA from the ER back to L1.
 * Sends commit+undelegate to ER, then polls L1 until the account owner
 * changes from DELEGATION_PROGRAM back to our program (max 90s).
 */
export async function undelegateBet(wallet: AnchorWallet, betPda: PublicKey): Promise<void> {
  const erConn = new Connection(MAGIC_ROUTER, 'confirmed');
  const l1Conn = new Connection(DEVNET_RPC, 'confirmed');

  const ix = createCommitAndUndelegateInstruction(wallet.publicKey, [betPda]);
  const tx = new Transaction();
  tx.add(ix);
  const { blockhash } = await erConn.getLatestBlockhash('confirmed');
  tx.recentBlockhash = blockhash;
  tx.feePayer = wallet.publicKey;
  const signed = await wallet.signTransaction(tx);
  const erSig = await erConn.sendRawTransaction(signed.serialize(), { skipPreflight: true });
  console.log('[UNDELEGATE] ER tx sent:', erSig);

  // Poll L1 until bet account owner changes from DELEGATION_PROGRAM → our program
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 2000));
    const info = await l1Conn.getAccountInfo(betPda, 'confirmed');
    if (info && !info.owner.equals(DELEGATION_PROGRAM)) {
      console.log('[UNDELEGATE] Bet back on L1, owner:', info.owner.toBase58());
      return;
    }
    console.log('[UNDELEGATE] Still waiting for L1 commit...');
  }
  throw new Error('Undelegation timeout: bet did not return to L1 within 90s');
}
