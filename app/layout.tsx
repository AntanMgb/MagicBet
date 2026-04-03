import type { Metadata } from 'next';
import { Unbounded, Lexend, Fira_Code } from 'next/font/google';
import './globals.css';
import '@solana/wallet-adapter-react-ui/styles.css';
import { SolanaWalletProvider } from '@/components/WalletProvider';

const unbounded = Unbounded({
  subsets: ['latin'],
  weight: ['400', '700', '800', '900'],
  variable: '--font-unbounded',
  display: 'swap',
});

const lexend = Lexend({
  subsets: ['latin'],
  weight: ['300', '400', '500'],
  variable: '--font-lexend',
  display: 'swap',
});

const firaCode = Fira_Code({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-fira',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'MagicBet — Private Prediction Markets',
  description: 'Bet on crypto with hidden positions powered by MagicBlock Private Ephemeral Rollups (TEE)',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${unbounded.variable} ${lexend.variable} ${firaCode.variable}`}>
      <body style={{ fontFamily: 'var(--font-lexend), sans-serif', background: '#050508', color: '#fff', minHeight: '100vh' }}>
        <SolanaWalletProvider>
          {children}
        </SolanaWalletProvider>
      </body>
    </html>
  );
}
