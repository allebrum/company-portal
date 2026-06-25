'use client';

import { QrCodeManager } from '@/components/tools/QrCodeManager';
import { useSpace } from '@/contexts/SpaceContext';

export default function QrToolPage() {
  const { openSpace } = useSpace();

  return (
    <div className="space-y-7 max-w-5xl">
      <div>
        <div className="eyebrow">Tools</div>
        <h1 className="text-2xl font-bold text-gray-900">QR Code Generator</h1>
        <p className="mt-1 text-sm text-gray-500">
          Mint trackable QR codes. Every scan logs the device, IP, and approximate location.
        </p>
      </div>

      <QrCodeManager
        onOpenClient={(id) => openSpace({ kind: 'client', id })}
        onOpenProject={(id) => openSpace({ kind: 'project', id })}
      />
    </div>
  );
}
