import './globals.css';
import type { Metadata } from 'next';
import { QueryProvider } from '@/components/providers/query-provider';
import { AppShell } from '@/components/onboarding-guard';

export const metadata: Metadata = {
  title: 'Auto SDR',
  description: 'Autonomous lead generation system',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('theme');if(t==='light'){document.documentElement.setAttribute('data-theme','light')}else{document.documentElement.classList.add('dark')}}catch(e){}})()`,
          }}
        />
      </head>
      <body className="min-h-screen bg-surface">
        <QueryProvider>
          <AppShell>{children}</AppShell>
        </QueryProvider>
      </body>
    </html>
  );
}
