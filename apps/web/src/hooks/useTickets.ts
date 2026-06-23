'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { TicketRow, TicketDetail, TicketMessageRow, UpdateTicketInput } from '@modernzen/shared';
import { api } from '@/lib/api';
import { qk } from '@/lib/queryKeys';

/** Sprint 4 — staff-side ticket hooks (the portal side lives in usePortal.ts). */

export function useTickets(filter: { clientId?: string; status?: string } = {}, enabled = true) {
  const params = new URLSearchParams();
  if (filter.clientId) params.set('clientId', filter.clientId);
  if (filter.status) params.set('status', filter.status);
  const qs = params.toString();
  return useQuery({
    queryKey: [...qk.tickets, filter] as const,
    queryFn: () => api.get<TicketRow[]>(`/tickets${qs ? `?${qs}` : ''}`),
    enabled,
  });
}

export function useTicket(id: string | null) {
  return useQuery({
    queryKey: [...qk.tickets, 'detail', id ?? ''] as const,
    queryFn: () => api.get<TicketDetail>(`/tickets/${id}`),
    enabled: !!id,
  });
}

export function useUpdateTicket() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...patch }: UpdateTicketInput & { id: string }) =>
      api.patch<TicketRow>(`/tickets/${id}`, patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.tickets });
      // Status changes mirror into the linked todo.
      qc.invalidateQueries({ queryKey: qk.todos });
    },
  });
}

export function useReplyTicket() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: string }) =>
      api.post<TicketMessageRow>(`/tickets/${id}/messages`, { body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.tickets }),
  });
}
