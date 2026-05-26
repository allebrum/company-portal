'use client';

import { Mail } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { gmailConnectUrl } from '@/hooks/useGmail';

/**
 * Just-in-time "you need to connect Gmail to send this" modal. Triggered
 * from invite / resend-invite flows when the current user doesn't have a
 * Gmail OAuth token yet. The connect button redirects to the OAuth consent
 * screen with a `return_to` so the user lands back where they were.
 *
 * The "Skip email" option flips the parent's `sendInvite` toggle off and
 * closes the modal — keeps the admin from being stuck if they decide to
 * just create the account and hand off the link some other way.
 */
export function ConnectGmailModal({
  open,
  onClose,
  onSkipEmail,
  returnTo,
}: {
  open: boolean;
  onClose: () => void;
  /** Called when the user picks "Send without email". The parent should
   *  flip its own `sendInvite` state to false and then proceed. */
  onSkipEmail?: () => void;
  /** Same-origin path to return to after consent — e.g. `/admin?tab=users`.
   *  Defaults to the current pathname when omitted. */
  returnTo?: string;
}) {
  const fallbackReturn = typeof window !== 'undefined' ? window.location.pathname + window.location.search : '/admin';
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Connect Gmail to send invites"
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          {onSkipEmail && (
            <Button
              variant="outline"
              onClick={() => {
                onSkipEmail();
                onClose();
              }}
            >
              Skip email
            </Button>
          )}
          <a href={gmailConnectUrl(returnTo ?? fallbackReturn)}>
            <Button variant="primary">
              <Mail className="w-4 h-4" /> Connect Gmail
            </Button>
          </a>
        </>
      }
    >
      <div className="space-y-3 text-sm text-gray-700">
        <p>
          Invites go out from <strong>your own Gmail</strong>, so the recipient sees a real teammate's
          name and address — not a no-reply.
        </p>
        <p>
          Click <em>Connect Gmail</em>, approve the send permission, and you'll come right back here
          ready to send. You can disconnect at any time in <em>Settings → Integrations</em>.
        </p>
        {onSkipEmail && (
          <p className="text-[12px] text-gray-500">
            Or pick <em>Skip email</em> to just create the account — they won't get an automatic
            invite and you'll need to share the sign-in link manually.
          </p>
        )}
      </div>
    </Modal>
  );
}
