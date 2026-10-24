'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { RefreshCw, X } from 'lucide-react';
import { applyUpdate, getSwState, startServiceWorker, subscribeSw } from '@/lib/pwa/serviceWorker';
import { initInstallState } from '@/lib/pwa/install';

const SERVER_STATE = { updateReady: false };

/**
 * Registers the service worker and, when a newer build is waiting, shows a
 * persistent "New version available · Reload" prompt. It deliberately does
 * not auto-reload: someone may be mid-edit. Dismissing hides it until the
 * next update is found.
 */
export function PwaUpdateToast() {
  useEffect(() => {
    startServiceWorker();
    initInstallState();
  }, []);
  const { updateReady } = useSyncExternalStore(subscribeSw, getSwState, () => SERVER_STATE);
  const [dismissed, setDismissed] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (updateReady) setDismissed(false);
  }, [updateReady]);

  if (!updateReady || dismissed) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="pwa-update-toast"
      className="fixed left-1/2 -translate-x-1/2 bottom-4 mb-[env(safe-area-inset-bottom)] z-[240] flex items-center gap-3 rounded-xl bg-gray-900 text-white shadow-xl pl-4 pr-2 py-2 text-sm max-w-[calc(100vw-2rem)]"
    >
      <RefreshCw className="w-4 h-4 shrink-0 text-brand-300" aria-hidden />
      <span className="leading-snug">New version available</span>
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          applyUpdate();
        }}
        className="ml-1 rounded-lg bg-brand-600 hover:bg-brand-500 px-3 py-1.5 text-xs font-bold disabled:opacity-60"
      >
        {busy ? 'Reloading…' : 'Reload'}
      </button>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label="Dismiss"
        className="p-1.5 rounded-md text-gray-400 hover:text-white hover:bg-white/10"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
