'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { API_URL } from '@/lib/env';
import type { CreateQboInvoiceInput } from '@allebrum/shared';
import type { EntryRow } from '@/hooks/useResources';

// Client invoicing — which hours have (not) been billed — plus the
// QuickBooks Online integration surface. All routes behind `invoices.manage`
// except the QBO status/connect, which follow the Drive pattern.

export type QboStatus = {
  configured: boolean;
  connected: boolean;
  companyName: string | null;
  environment: 'sandbox' | 'production';
  lastConnectedAt: string | null;
};
export type QboCustomer = { id: string; displayName: string };
export type QboItem = { id: string; name: string };
export type QboInvoiceResult = {
  id: string;
  docNumber: string | null;
  total: number;
  marked: number;
  customerId: string;
};

/** Consent-redirect URL for connecting QuickBooks (same shape as Drive). */
export const qboConnectUrl = (returnTo?: string): string => {
  const base = `${API_URL}/api/integrations/quickbooks/connect`;
  return returnTo ? `${base}?return_to=${encodeURIComponent(returnTo)}` : base;
};

export function useQboStatus(enabled = true) {
  return useQuery({
    queryKey: ['qboStatus'] as const,
    enabled,
    queryFn: () => api.get<QboStatus>('/integrations/quickbooks/status'),
  });
}

export function useQboCustomers(search: string, enabled: boolean) {
  return useQuery({
    queryKey: ['qboCustomers', search] as const,
    enabled,
    staleTime: 60_000,
    queryFn: () =>
      api.get<QboCustomer[]>(
        `/integrations/quickbooks/customers${search ? `?search=${encodeURIComponent(search)}` : ''}`,
      ),
  });
}

export function useQboItems(enabled: boolean) {
  return useQuery({
    queryKey: ['qboItems'] as const,
    enabled,
    staleTime: 60_000,
    queryFn: () => api.get<QboItem[]>('/integrations/quickbooks/items'),
  });
}

/** Entries for one client's or one project's invoicing tab. */
export function useInvoicingEntries(
  scope: { clientId?: string; projectId?: string },
  enabled = true,
) {
  const param = scope.projectId
    ? `projectId=${scope.projectId}`
    : scope.clientId
      ? `clientId=${scope.clientId}`
      : '';
  return useQuery({
    queryKey: ['invoicing', scope.projectId ?? scope.clientId ?? 'none'] as const,
    enabled: enabled && !!param,
    queryFn: () => api.get<EntryRow[]>(`/invoicing/entries?${param}`),
  });
}

export function useMarkInvoiced() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { ids: string[]; invoiceRef?: string }) =>
      api.post<{ count: number }>('/invoicing/mark', input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['invoicing'] });
      qc.invalidateQueries({ queryKey: ['entries'] });
    },
  });
}

export function useUnmarkInvoiced() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids: string[]) => api.post<{ count: number }>('/invoicing/unmark', { ids }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['invoicing'] });
      qc.invalidateQueries({ queryKey: ['entries'] });
    },
  });
}

export function useCreateQboInvoice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateQboInvoiceInput) =>
      api.post<QboInvoiceResult>('/invoicing/quickbooks/invoice', input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['invoicing'] });
      qc.invalidateQueries({ queryKey: ['entries'] });
      qc.invalidateQueries({ queryKey: ['clients'] });
    },
  });
}
