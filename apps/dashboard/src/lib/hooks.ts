import { useQuery } from '@tanstack/react-query';
import { apiFetch } from './api';

export function useHealth() {
  return useQuery({ queryKey: ['health'], queryFn: () => apiFetch('/api/health/overview'), staleTime: 30_000 });
}

export function useLeads(filters?: Record<string, string>) {
  const params = new URLSearchParams(filters);
  return useQuery({ queryKey: ['leads', filters], queryFn: () => apiFetch(`/api/leads?${params}`), staleTime: 15_000 });
}

export function useLead(id: string) {
  return useQuery({ queryKey: ['lead', id], queryFn: () => apiFetch(`/api/leads/${id}`), staleTime: 15_000, enabled: !!id });
}

export function useBudgets() {
  return useQuery({ queryKey: ['budgets'], queryFn: () => apiFetch('/api/budgets'), staleTime: 60_000 });
}

export function useCampaigns() {
  return useQuery({ queryKey: ['campaigns'], queryFn: () => apiFetch('/api/campaigns'), staleTime: 60_000 });
}

export function useKeywords() {
  return useQuery({ queryKey: ['keywords'], queryFn: () => apiFetch('/api/keywords'), staleTime: 60_000 });
}

export function useSources() {
  return useQuery({ queryKey: ['sources'], queryFn: () => apiFetch('/api/sources'), staleTime: 60_000 });
}

export function useReplies(filters?: Record<string, string>) {
  const params = new URLSearchParams(filters);
  return useQuery({ queryKey: ['replies', filters], queryFn: () => apiFetch(`/api/replies?${params}`), staleTime: 30_000 });
}

export function useAlerts() {
  return useQuery({ queryKey: ['alerts'], queryFn: () => apiFetch('/api/alerts'), staleTime: 30_000 });
}

export function useDailyStats() {
  return useQuery({ queryKey: ['daily-stats'], queryFn: () => apiFetch('/api/stats/today'), staleTime: 60_000 });
}

export function usePaperclipActions() {
  return useQuery({ queryKey: ['paperclip-actions'], queryFn: () => apiFetch('/api/paperclip/actions'), staleTime: 30_000 });
}

export function usePaperclipRecommendations() {
  return useQuery({ queryKey: ['paperclip-recommendations'], queryFn: () => apiFetch('/api/paperclip/recommendations'), staleTime: 60_000 });
}

export function useSessions() {
  return useQuery({ queryKey: ['sessions'], queryFn: () => apiFetch('/api/sessions'), staleTime: 30_000 });
}

export function useServiceStatus() {
  return useQuery({ queryKey: ['service-status'], queryFn: () => apiFetch('/api/settings/services'), staleTime: 30_000 });
}

export function useFeatureFlags() {
  return useQuery({ queryKey: ['feature-flags'], queryFn: () => apiFetch('/api/settings/flags'), staleTime: 60_000 });
}

export function useManualReview() {
  return useQuery({ queryKey: ['manual-review'], queryFn: () => apiFetch('/api/manual-review'), staleTime: 30_000 });
}

export function useSchedule() {
  return useQuery({ queryKey: ['schedule'], queryFn: () => apiFetch('/api/schedule'), staleTime: 60_000 });
}

export function useProviderSettings() {
  return useQuery({ queryKey: ['provider-settings'], queryFn: () => apiFetch('/api/settings'), staleTime: 30_000 });
}

export function useDeliverabilityDomains(healthStatus?: string) {
  const params = healthStatus ? `?healthStatus=${healthStatus}` : '';
  return useQuery({ queryKey: ['domains', healthStatus], queryFn: () => apiFetch(`/api/deliverability/domains${params}`), staleTime: 30_000 });
}

export function useDeliverabilityInboxes(filters?: Record<string, string>) {
  const params = new URLSearchParams(filters);
  return useQuery({ queryKey: ['inboxes', filters], queryFn: () => apiFetch(`/api/deliverability/inboxes?${params}`), staleTime: 30_000 });
}

export function useDeliverabilityCapacity() {
  return useQuery({ queryKey: ['capacity'], queryFn: () => apiFetch('/api/deliverability/capacity'), staleTime: 30_000 });
}

export function useDeliverabilityOverview() {
  return useQuery({ queryKey: ['deliverability-overview'], queryFn: () => apiFetch('/api/deliverability/overview'), staleTime: 30_000 });
}

export function useOnboardingStatus() {
  return useQuery({ queryKey: ['onboarding-status'], queryFn: () => apiFetch('/api/settings/onboarding-status'), staleTime: 60_000 });
}
