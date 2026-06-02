'use client';

import { useEffect, useMemo, useState } from 'react';
import { QRCodeCanvas } from 'qrcode.react';
import { ExternalLink, QrCode } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { useCreateQrUploadSession, type QrUploadTarget, type CreateQrUploadSessionResult } from '@/hooks/useQrUploadSession';

export function QrUploadModal({
  open,
  onClose,
  target,
  label,
}: {
  open: boolean;
  onClose: () => void;
  target: QrUploadTarget;
  label: string;
}) {
  const toast = useToast();
  const create = useCreateQrUploadSession();
  const [session, setSession] = useState<CreateQrUploadSessionResult | null>(null);
  const targetKey = useMemo(() => JSON.stringify(target), [target]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setSession(null);
    void create.mutateAsync({ target, label, expiresInHours: 24 }).then(
      (res) => {
        if (!cancelled) setSession(res);
      },
      () => {
        if (!cancelled) setSession(null);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [open, targetKey, label]);

  const expiry = useMemo(() => {
    if (!session?.expiresAt) return null;
    const d = new Date(session.expiresAt);
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleString();
  }, [session?.expiresAt]);

  const copyLink = async () => {
    if (!session?.uploadUrl) return;
    try {
      await navigator.clipboard.writeText(session.uploadUrl);
      toast.success('Upload link copied');
    } catch {
      toast.error('Could not copy link');
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Upload by QR code" size="md" layerBase={140}>
      <div className="space-y-4">
        <p className="text-sm text-gray-600">
          Scan this code with a phone to upload photos/files directly into <span className="font-semibold text-gray-900">{label}</span>.
        </p>

        {!session ? (
          <div className="rounded-xl border border-gray-200 bg-gray-50 p-8 text-center text-sm text-gray-500">
            Generating secure upload link…
          </div>
        ) : (
          <>
            <div className="rounded-2xl border border-gray-200 bg-white p-4 grid place-items-center">
              <QRCodeCanvas value={session.uploadUrl} size={220} includeMargin />
            </div>
            <div className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-[12px] text-gray-700 break-all">
              {session.uploadUrl}
            </div>
            {expiry && (
              <div className="text-[11px] text-gray-500">Link expires: {expiry}</div>
            )}
            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={copyLink}>
                <QrCode className="w-4 h-4" /> Copy link
              </Button>
              <a href={session.uploadUrl} target="_blank" rel="noreferrer">
                <Button variant="ghost">
                  <ExternalLink className="w-4 h-4" /> Open page
                </Button>
              </a>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
