import type { ReactNode } from 'react';
import './globals.css';

export const metadata = { title: 'AFTERMATH — Transaction inspection', description: 'Your transaction ended. Its permissions didn’t.' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
