'use client';

import { useRef, useState, useSyncExternalStore } from 'react';
import { Download, Share, SquarePlus } from 'lucide-react';
import { Popover } from '@/components/ui/Popover';
import { getInstallState, getServerInstallState, promptInstall, subscribeInstall } from '@/lib/pwa/install';

/**
 * Unobtrusive "Install app" entry for the sidebar footer.
 *  - Chromium (Chrome/Edge desktop + Android): uses the deferred
 *    `beforeinstallprompt` to open the native install dialog.
 *  - iOS/iPadOS Safari: no prompt API exists, so a small how-to.
 *  - Already installed / unsupported browser: renders nothing.
 */
export function InstallAppButton() {
  const s = useSyncExternalStore(subscribeInstall, getInstallState, getServerInstallState);
  const [busy, setBusy] = useState(false);
  const [hintOpen, setHintOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);

  if (s.installed || (!s.canPrompt && !s.iosHint)) return null;

  const cls =
    'w-full flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs font-semibold text-gray-500 hover:text-brand-700 hover:bg-brand-50';

  if (s.canPrompt) {
    return (
      <button
        type="button"
        data-testid="install-app-button"
        disabled={busy}
        className={cls}
        onClick={async () => {
          setBusy(true);
          try {
            await promptInstall();
          } finally {
            setBusy(false);
          }
        }}
      >
        <Download className="w-3.5 h-3.5" aria-hidden />
        Install app
      </button>
    );
  }

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        data-testid="install-app-ios"
        aria-expanded={hintOpen}
        className={cls}
        onClick={() => setHintOpen((o) => !o)}
      >
        <Download className="w-3.5 h-3.5" aria-hidden />
        Install app
      </button>
      <Popover open={hintOpen} onClose={() => setHintOpen(false)} anchorRef={anchorRef} align="start">
      <div data-testid="install-app-ios-hint" className="w-64 p-3 text-xs text-gray-600 leading-relaxed">
        <div className="font-semibold text-gray-900 text-sm mb-1.5">Add Hoppa to your Home Screen</div>
        <ol className="space-y-1.5 list-decimal pl-4">
          <li>
            Tap <Share className="inline w-3.5 h-3.5 -mt-0.5" aria-label="Share" /> <b>Share</b> in Safari’s toolbar.
          </li>
          <li>
            Choose <SquarePlus className="inline w-3.5 h-3.5 -mt-0.5" aria-hidden /> <b>Add to Home Screen</b>, then <b>Add</b>.
          </li>
        </ol>
        <div className="mt-2 text-gray-400">Hoppa then opens full-screen like an app.</div>
      </div>
      </Popover>
    </>
  );
}
