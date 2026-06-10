'use client';

import { type ReactNode } from 'react';
import { Mail, FolderOpen, type LucideIcon } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { gmailConnectUrl } from '@/hooks/useGmail';
import { driveConnectUrl } from '@/hooks/useDrive';

export type IntegrationKind = 'gmail' | 'drive';

/**
 * Generalized "you need to connect <integration> to do this" modal. Replaces
 * the old Gmail-only ConnectGmailModal so any flow (invites → Gmail, media →
 * Drive, the onboarding card) can drive a connect from one component.
 *
 * The connect button is a plain anchor to the OAuth consent URL with a
 * `returnTo` so the callback bounces the user straight back where they were
 * (the IntegrationGate then toasts + refreshes status on return).
 */
const COPY: Record<
  IntegrationKind,
  { title: string; icon: LucideIcon; connectLabel: string; url: (returnTo?: string) => string; body: ReactNode }
> = {
  gmail: {
    title: 'Connect Gmail',
    icon: Mail,
    connectLabel: 'Connect Gmail',
    url: gmailConnectUrl,
    body: (
      <p>
        Emails go out from <strong>your own Gmail</strong>, so the recipient sees a real
        teammate&apos;s name and address — not a no-reply. You can disconnect any time in{' '}
        <em>Settings → Integrations</em>.
      </p>
    ),
  },
  drive: {
    title: 'Connect Google Drive',
    icon: FolderOpen,
    connectLabel: 'Connect Google Drive',
    url: driveConnectUrl,
    body: (
      <p>
        Files and client folders live in <strong>your workspace&apos;s Google Drive</strong>.
        An admin connects it once and the whole team shares the same Drive. You can disconnect
        any time in <em>Settings → Integrations</em>.
      </p>
    ),
  },
};

export function ConnectIntegrationModal({
  open,
  onClose,
  integration,
  reason,
  onSkip,
  skipLabel = 'Skip',
  returnTo,
}: {
  open: boolean;
  onClose: () => void;
  integration: IntegrationKind;
  /** Optional context line explaining the action that triggered the gate. */
  reason?: ReactNode;
  /** When provided, shows a secondary "skip" button (e.g. "Skip email"). */
  onSkip?: () => void;
  skipLabel?: string;
  /** Same-origin path to return to after consent; defaults to current URL. */
  returnTo?: string;
}) {
  const c = COPY[integration];
  const Icon = c.icon;
  const fallbackReturn =
    typeof window !== 'undefined' ? window.location.pathname + window.location.search : '/dashboard';
  const href = c.url(returnTo ?? fallbackReturn);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={c.title}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          {onSkip && (
            <Button
              variant="outline"
              onClick={() => {
                onSkip();
                onClose();
              }}
            >
              {skipLabel}
            </Button>
          )}
          <a href={href}>
            <Button variant="primary">
              <Icon className="w-4 h-4" /> {c.connectLabel}
            </Button>
          </a>
        </>
      }
    >
      <div className="space-y-3 text-sm text-gray-700">
        {reason && <p>{reason}</p>}
        {c.body}
        <p className="text-[12px] text-gray-500">
          Click <em>{c.connectLabel}</em>, approve access, and you&apos;ll come right back here.
        </p>
      </div>
    </Modal>
  );
}
