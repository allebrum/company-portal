'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/components/ui/Toast';
import { useGmailStatus } from '@/hooks/useGmail';
import { useDriveStatus } from '@/hooks/useDrive';
import {
  ConnectIntegrationModal,
  type IntegrationKind,
} from '@/components/features/ConnectIntegrationModal';

type RequireOpts = {
  integration: IntegrationKind;
  /** Runs immediately when the integration is already connected (or can't be
   *  connected on this instance, so we degrade gracefully). */
  action: () => void;
  reason?: ReactNode;
  /** Optional escape hatch — e.g. "Skip email" on the invite flow. */
  onSkip?: () => void;
  skipLabel?: string;
};

type GateApi = {
  /** Ensure an integration is connected before running an action. If it isn't,
   *  pops the connect modal so the user can set it up and continue. */
  requireIntegration: (opts: RequireOpts) => void;
  /** Open the connect modal directly (no gated action) — for the onboarding
   *  card's "Connect" buttons. */
  openConnect: (integration: IntegrationKind, opts?: { reason?: ReactNode }) => void;
};

const GateContext = createContext<GateApi | null>(null);

type ModalState = {
  integration: IntegrationKind;
  reason?: ReactNode;
  onSkip?: () => void;
  skipLabel?: string;
};

const LABEL: Record<IntegrationKind, string> = { gmail: 'Gmail', drive: 'Google Drive' };

export function IntegrationGateProvider({ children }: { children: ReactNode }) {
  const toast = useToast();
  const qc = useQueryClient();
  const gmail = useGmailStatus();
  const drive = useDriveStatus();
  const [modal, setModal] = useState<ModalState | null>(null);

  const requireIntegration = useCallback(
    (opts: RequireOpts) => {
      const st = opts.integration === 'gmail' ? gmail.data : drive.data;
      // Gate only when we KNOW the OAuth is configured but not yet connected.
      // Unknown (still loading) or not-configured (self-host without Google
      // OAuth) → just run; the server degrades gracefully.
      if (st && st.configured && !st.connected) {
        setModal({
          integration: opts.integration,
          reason: opts.reason,
          onSkip: opts.onSkip,
          skipLabel: opts.skipLabel,
        });
      } else {
        opts.action();
      }
    },
    [gmail.data, drive.data],
  );

  const openConnect = useCallback<GateApi['openConnect']>((integration, opts) => {
    setModal({ integration, reason: opts?.reason });
  }, []);

  // Handle the OAuth redirect-return: the connect callbacks bounce the browser
  // back with `?gmail=connected` / `?drive=connected` (or an error code). The
  // round-trip is always a full navigation, so processing once on mount is
  // enough; we then strip the flag from the URL without a re-navigation.
  const handledRef = useRef(false);
  useEffect(() => {
    if (handledRef.current) return;
    handledRef.current = true;
    const params = new URLSearchParams(window.location.search);
    const checks: Array<{ kind: IntegrationKind; param: string; queryKey: string }> = [
      { kind: 'gmail', param: 'gmail', queryKey: 'gmailStatus' },
      { kind: 'drive', param: 'drive', queryKey: 'driveStatus' },
    ];
    let changed = false;
    for (const { kind, param, queryKey } of checks) {
      const val = params.get(param);
      if (!val) continue;
      changed = true;
      params.delete(param);
      if (val === 'connected') {
        toast.success(`${LABEL[kind]} connected — you're all set.`);
        qc.invalidateQueries({ queryKey: [queryKey] });
        if (kind === 'drive') qc.invalidateQueries({ queryKey: ['integrations'] });
      } else if (val === 'bad_state') {
        toast.error(`That ${LABEL[kind]} connection expired — please try again.`);
      } else {
        toast.error(`Couldn't connect ${LABEL[kind]} — please try again.`);
      }
    }
    if (changed) {
      const qs = params.toString();
      const clean = window.location.pathname + (qs ? `?${qs}` : '') + window.location.hash;
      window.history.replaceState({}, '', clean);
    }
  }, [qc, toast]);

  const api = useMemo<GateApi>(
    () => ({ requireIntegration, openConnect }),
    [requireIntegration, openConnect],
  );

  return (
    <GateContext.Provider value={api}>
      {children}
      <ConnectIntegrationModal
        open={!!modal}
        onClose={() => setModal(null)}
        integration={modal?.integration ?? 'gmail'}
        reason={modal?.reason}
        onSkip={modal?.onSkip}
        skipLabel={modal?.skipLabel}
      />
    </GateContext.Provider>
  );
}

export function useIntegrationGate(): GateApi {
  const ctx = useContext(GateContext);
  if (!ctx) throw new Error('useIntegrationGate must be used inside IntegrationGateProvider');
  return ctx;
}
