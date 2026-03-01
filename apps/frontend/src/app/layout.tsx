import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Repowise — RAG over GitHub Repos',
  description: 'Ask questions about any GitHub repository using NestJS RAG pipeline',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body>{children}</body>
    </html>
  );
}
