'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useOnboardingStatus } from '@/lib/hooks';
import { useEffect, useState, useCallback } from 'react';
import { Sidebar } from '@/components/layout/sidebar';
import { CommandPalette } from '@/components/command-palette';
import { checkApiHealth, isUsingMockData } from '@/lib/api';
import { Wifi, WifiOff } from 'lucide-react';

function StatusBanner() {
  const [checking, setChecking] = useState(false);
  const mockData = isUsingMockData();

  const handleRetry = useCallback(async () => {
    setChecking(true);
    const live = await checkApiHealth();
    if (live) window.location.reload();
    setChecking(false);
  }, []);

  if (!mockData) return null;

  return (
    <div className="flex items-center justify-between gap-3 border-b border-yellow-500/20 bg-yellow-500/5 px-6 py-1.5 text-xs">
      <div className="flex items-center gap-2">
        <WifiOff className="h-3 w-3 text-yellow-500/70" />
        <span className="text-text-muted">
          Showing sample data — backend API not connected
        </span>
      </div>
      <button
        onClick={handleRetry}
        disabled={checking}
        className="shrink-0 rounded px-2 py-0.5 text-[11px] font-medium text-yellow-600 hover:bg-yellow-500/10 transition-colors disabled:opacity-50"
      >
        {checking ? 'Checking...' : 'Retry'}
      </button>
    </div>
  );
}

function DashboardShell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <CommandPalette />
      <div className="flex h-screen">
        <Sidebar />
        <main className="flex-1 overflow-auto">
          <StatusBanner />
          <div className="p-6 pb-24 md:pb-6">{children}</div>
        </main>
      </div>
    </>
  );
}

function OnboardingShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen overflow-auto">
      <div className="p-6">{children}</div>
    </main>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { data, isLoading, isError } = useOnboardingStatus();

  const onboardingData = data as { complete?: boolean } | undefined;
  const isOnboardingRoute = pathname.startsWith('/onboarding');

  useEffect(() => {
    if (isLoading || isError) return;
    const steps = (onboardingData as any)?.steps;
    const hasAnyKeys = steps?.apiKeys?.configured > 0;
    if (!onboardingData?.complete && !hasAnyKeys && !isOnboardingRoute) {
      router.replace('/onboarding');
    }
  }, [onboardingData, isLoading, isError, isOnboardingRoute, router]);

  if (isOnboardingRoute) {
    return <OnboardingShell>{children}</OnboardingShell>;
  }

  return <DashboardShell>{children}</DashboardShell>;
}
