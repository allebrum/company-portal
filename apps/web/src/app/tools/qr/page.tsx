'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { QRCodeCanvas } from 'qrcode.react';
import {
  Copy,
  Download,
  ExternalLink,
  FileSpreadsheet,
  Globe,
  Image as ImageIcon,
  Lock,
  QrCode as QrCodeIcon,
  Trash2,
  Users,
} from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import {
  useQrCodes,
  useCreateQrCode,
  useUpdateQrCode,
  useDeleteQrCode,
  useQrScans,
  qrImagePngUrl,
  qrScansCsvUrl,
  trackingUrlFor,
} from '@/hooks/useQr';
import { Modal } from '@/components/ui/Modal';
import { Field, Input, Select } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { useConfirm } from '@/components/ui/ConfirmDialog';
import { relativeFromIso } from '@/lib/formatters';
import type { QrCodeRow, QrErrorLevel, QrVisibility, QrScanRow } from '@modernzen/shared';

const LOGO_MAX_BYTES = 100_000;

export default function QrToolPage() {
  const { me } = useAuth();
  const codes = useQrCodes();
  const create = useCreateQrCode();
  const toast = useToast();

  const [label, setLabel] = useState('');
  const [targetUrl, setTargetUrl] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);

  const onCreate = async () => {
    const url = targetUrl.trim();
    if (!url) return;
    try {
      const row = await create.mutateAsync({ label: label.trim(), targetUrl: url });
      setLabel('');
      setTargetUrl('');
      setOpenId(row.id);
      toast.success('QR code created');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Create failed');
    }
  };

  const openRow = codes.data?.find((c) => c.id === openId) ?? null;

  return (
    <div className="space-y-7 max-w-5xl">
      <div>
        <div className="eyebrow">Tools</div>
        <h1 className="text-2xl font-bold text-gray-900">QR Code Generator</h1>
        <p className="mt-1 text-sm text-gray-500">
          Mint trackable QR codes. Every scan logs the device, IP, and approximate location.
        </p>
      </div>

      {/* Create */}
      <div className="rounded-2xl border border-gray-200 bg-white p-5">
        <div className="text-[11px] uppercase tracking-widest font-bold text-gray-500 mb-3">
          New code
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Label">
            <Input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Campaign A — flyer"
            />
          </Field>
          <Field label="Target URL">
            <Input
              type="url"
              value={targetUrl}
              onChange={(e) => setTargetUrl(e.target.value)}
              placeholder="https://example.com/landing"
            />
          </Field>
        </div>
        <div className="mt-3 flex justify-end">
          <Button
            variant="primary"
            onClick={onCreate}
            disabled={create.isPending || !targetUrl.trim()}
          >
            <QrCodeIcon className="w-4 h-4" />
            Generate
          </Button>
        </div>
      </div>

      {/* List */}
      <div>
        <div className="text-[11px] uppercase tracking-widest font-bold text-gray-500 mb-2">
          My codes · {codes.data?.length ?? 0}
        </div>
        {!codes.data ? (
          <div className="rounded-xl bg-gray-100 animate-pulse h-32" />
        ) : codes.data.length === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 p-8 text-center">
            <div className="font-semibold text-gray-700">No codes yet</div>
            <p className="mt-1 text-sm text-gray-500">
              Create one above to start tracking scans.
            </p>
          </div>
        ) : (
          <ul className="rounded-2xl border border-gray-200 bg-white divide-y divide-gray-100">
            {codes.data.map((c) => (
              <CodeRow
                key={c.id}
                code={c}
                isOwn={c.ownerUserId === me?.id}
                onOpen={() => setOpenId(c.id)}
              />
            ))}
          </ul>
        )}
      </div>

      {openRow && (
        <DetailModal
          open={!!openRow}
          code={openRow}
          isOwner={openRow.ownerUserId === me?.id}
          onClose={() => setOpenId(null)}
        />
      )}
    </div>
  );
}

// ---- Row -------------------------------------------------------------

function CodeRow({
  code,
  isOwn,
  onOpen,
}: {
  code: QrCodeRow;
  isOwn: boolean;
  onOpen: () => void;
}) {
  const del = useDeleteQrCode();
  const toast = useToast();
  const confirmDialog = useConfirm();
  return (
    <li className="px-4 py-3 flex items-center gap-3">
      <button
        type="button"
        onClick={onOpen}
        className="w-9 h-9 rounded-md flex items-center justify-center shrink-0 border border-gray-200"
        style={{ backgroundColor: code.backgroundColor }}
        title="Open"
      >
        <QrCodeIcon className="w-4 h-4" style={{ color: code.foregroundColor }} />
      </button>
      <button type="button" onClick={onOpen} className="flex-1 min-w-0 text-left">
        <div className="text-sm font-semibold text-gray-900 truncate">
          {code.label || code.shortCode}
        </div>
        <div className="text-[11px] text-gray-500 truncate">{code.targetUrl}</div>
      </button>
      <span
        className="hidden sm:inline-flex items-center gap-1 text-[10px] uppercase tracking-wider font-bold rounded-full px-2 py-0.5"
        style={
          code.visibility === 'workspace'
            ? { backgroundColor: '#eef2ff', color: '#4338ca' }
            : { backgroundColor: '#f3f4f6', color: '#6b7280' }
        }
        title={code.visibility === 'workspace' ? 'Shared with workspace' : 'Private to you'}
      >
        {code.visibility === 'workspace' ? (
          <Users className="w-3 h-3" />
        ) : (
          <Lock className="w-3 h-3" />
        )}
        {code.visibility === 'workspace' ? 'Shared' : 'Private'}
      </span>
      {!isOwn && (
        <span className="text-[10px] uppercase tracking-wider text-gray-400">View only</span>
      )}
      {isOwn && (
        <button
          type="button"
          onClick={async () => {
            const ok = await confirmDialog({
              title: `Delete "${code.label || code.shortCode}"?`,
              body: 'Scan history is preserved.',
              confirmLabel: 'Delete code',
            });
            if (!ok) return;
            try {
              await del.mutateAsync(code.id);
              toast.success('Deleted');
            } catch (e) {
              toast.error(e instanceof Error ? e.message : 'Delete failed');
            }
          }}
          className="text-gray-300 hover:text-red-600"
          title="Delete"
          disabled={del.isPending}
        >
          <Trash2 className="w-4 h-4" />
        </button>
      )}
    </li>
  );
}

// ---- Detail modal ----------------------------------------------------

function DetailModal({
  open,
  code,
  isOwner,
  onClose,
}: {
  open: boolean;
  code: QrCodeRow;
  isOwner: boolean;
  onClose: () => void;
}) {
  const update = useUpdateQrCode();
  const scans = useQrScans(code.id);
  const toast = useToast();
  const confirmDialog = useConfirm();
  const canvasRef = useRef<HTMLDivElement>(null);

  // Local editor state — debounced PATCH to the server so dragging color
  // pickers doesn't spam the API.
  const [label, setLabel] = useState(code.label);
  const [targetUrl, setTargetUrl] = useState(code.targetUrl);
  const [visibility, setVisibility] = useState<QrVisibility>(code.visibility);
  const [foregroundColor, setForegroundColor] = useState(code.foregroundColor);
  const [backgroundColor, setBackgroundColor] = useState(code.backgroundColor);
  const [errorCorrection, setErrorCorrection] = useState<QrErrorLevel>(code.errorCorrection);
  const [logoDataUrl, setLogoDataUrl] = useState<string | null>(code.logoDataUrl);
  const [pendingTargetChange, setPendingTargetChange] = useState(false);

  useEffect(() => {
    setLabel(code.label);
    setTargetUrl(code.targetUrl);
    setVisibility(code.visibility);
    setForegroundColor(code.foregroundColor);
    setBackgroundColor(code.backgroundColor);
    setErrorCorrection(code.errorCorrection);
    setLogoDataUrl(code.logoDataUrl);
    setPendingTargetChange(false);
  }, [code.id]);

  const trackingUrl = trackingUrlFor(code.shortCode);

  const onLogoFile = (file: File | null) => {
    if (!file) {
      setLogoDataUrl(null);
      return;
    }
    if (!file.type.startsWith('image/')) {
      toast.error('Please pick an image file');
      return;
    }
    if (file.size > LOGO_MAX_BYTES) {
      toast.error(`Logo must be under ${LOGO_MAX_BYTES / 1000}KB`);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setLogoDataUrl(typeof reader.result === 'string' ? reader.result : null);
    reader.onerror = () => toast.error('Could not read image');
    reader.readAsDataURL(file);
  };

  const onSave = async () => {
    if (pendingTargetChange && targetUrl !== code.targetUrl) {
      const ok = await confirmDialog({
        title: 'Change the live target URL?',
        body: `This code is already live. Scanners will be sent to ${targetUrl} from now on.`,
        confirmLabel: 'Change target',
        danger: false,
      });
      if (!ok) return;
    }
    try {
      await update.mutateAsync({
        id: code.id,
        patch: {
          label,
          targetUrl,
          visibility,
          foregroundColor,
          backgroundColor,
          errorCorrection,
          logoDataUrl: logoDataUrl === code.logoDataUrl ? undefined : logoDataUrl,
        },
      });
      toast.success('Saved');
      setPendingTargetChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Save failed');
    }
  };

  const onDownloadPng = () => {
    if (logoDataUrl) {
      // Composite client-side so the logo is baked into the file.
      const canvas = canvasRef.current?.querySelector('canvas');
      if (!canvas) {
        toast.error('Preview not ready');
        return;
      }
      const data = canvas.toDataURL('image/png');
      const a = document.createElement('a');
      a.href = data;
      a.download = `qr-${code.label || code.shortCode}.png`;
      a.click();
    } else {
      // Plain code → server-rendered file is sharper.
      window.location.assign(qrImagePngUrl(code.id));
    }
  };

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(trackingUrl);
      toast.success('Tracking URL copied');
    } catch {
      toast.error('Could not copy');
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={code.label || code.shortCode}
      size="screen"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          {isOwner && (
            <Button
              variant="primary"
              onClick={onSave}
              disabled={update.isPending}
              title="Save edits"
            >
              Save changes
            </Button>
          )}
        </>
      }
    >
      <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-6">
        {/* Preview */}
        <div className="space-y-3">
          <div
            ref={canvasRef}
            className="rounded-2xl border border-gray-200 p-4 flex items-center justify-center"
            style={{ backgroundColor }}
          >
            <QRCodeCanvas
              value={trackingUrl}
              size={256}
              fgColor={foregroundColor}
              bgColor={backgroundColor}
              level={errorCorrection}
              imageSettings={
                logoDataUrl
                  ? { src: logoDataUrl, x: undefined, y: undefined, height: 56, width: 56, excavate: true }
                  : undefined
              }
            />
          </div>
          <div className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 flex items-center gap-2">
            <Globe className="w-3.5 h-3.5 text-gray-400 shrink-0" />
            <span className="text-[12px] font-mono text-gray-700 truncate flex-1" title={trackingUrl}>
              {trackingUrl}
            </span>
            <button type="button" onClick={onCopy} className="text-gray-400 hover:text-brand-700" title="Copy">
              <Copy className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" size="sm" onClick={onDownloadPng}>
              <Download className="w-3.5 h-3.5" />
              Download PNG
            </Button>
            <a href={code.targetUrl} target="_blank" rel="noreferrer">
              <Button variant="outline" size="sm">
                <ExternalLink className="w-3.5 h-3.5" />
                Visit target
              </Button>
            </a>
          </div>
        </div>

        {/* Editor */}
        <div className="space-y-4">
          {!isOwner && (
            <div className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-[12px] text-gray-600">
              You can view this code and its scan dashboard. Only the owner can edit.
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Label">
              <Input value={label} onChange={(e) => setLabel(e.target.value)} disabled={!isOwner} />
            </Field>
            <Field label="Target URL">
              <Input
                type="url"
                value={targetUrl}
                onChange={(e) => {
                  setTargetUrl(e.target.value);
                  setPendingTargetChange(e.target.value !== code.targetUrl);
                }}
                disabled={!isOwner}
              />
            </Field>
            <Field label="Visibility">
              <Select
                value={visibility}
                onChange={(e) => setVisibility(e.target.value as QrVisibility)}
                disabled={!isOwner}
              >
                <option value="private">Private to me</option>
                <option value="workspace">Shared with workspace</option>
              </Select>
            </Field>
            <Field label="Error correction">
              <Select
                value={errorCorrection}
                onChange={(e) => setErrorCorrection(e.target.value as QrErrorLevel)}
                disabled={!isOwner}
              >
                <option value="L">L · ~7%</option>
                <option value="M">M · ~15%</option>
                <option value="Q">Q · ~25%</option>
                <option value="H">H · ~30% (best with logo)</option>
              </Select>
            </Field>
            <Field label="Foreground">
              <Input
                type="color"
                value={foregroundColor}
                onChange={(e) => setForegroundColor(e.target.value)}
                disabled={!isOwner}
                className="h-10 w-20 p-1"
              />
            </Field>
            <Field label="Background">
              <Input
                type="color"
                value={backgroundColor}
                onChange={(e) => setBackgroundColor(e.target.value)}
                disabled={!isOwner}
                className="h-10 w-20 p-1"
              />
            </Field>
          </div>

          <Field label="Logo (optional, ≤100KB)">
            <div className="flex items-center gap-2">
              {logoDataUrl && (
                <img
                  src={logoDataUrl}
                  alt="logo preview"
                  className="w-10 h-10 rounded-md object-cover border border-gray-200"
                />
              )}
              <label
                className={`inline-flex items-center gap-2 rounded-xl border border-gray-200 px-3 py-2 text-[13px] ${
                  isOwner ? 'cursor-pointer hover:bg-gray-50' : 'opacity-60'
                }`}
              >
                <ImageIcon className="w-3.5 h-3.5" />
                {logoDataUrl ? 'Replace…' : 'Upload…'}
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => onLogoFile(e.target.files?.[0] ?? null)}
                  disabled={!isOwner}
                />
              </label>
              {logoDataUrl && isOwner && (
                <button
                  type="button"
                  onClick={() => setLogoDataUrl(null)}
                  className="text-[12px] text-gray-500 hover:text-red-600"
                >
                  Remove
                </button>
              )}
            </div>
          </Field>
        </div>
      </div>

      {/* Dashboard */}
      <div className="mt-6 pt-6 border-t border-gray-200">
        <Dashboard codeId={code.id} loading={scans.isLoading} summary={scans.data} />
      </div>
    </Modal>
  );
}

// ---- Dashboard --------------------------------------------------------

function Dashboard({
  codeId,
  loading,
  summary,
}: {
  codeId: string;
  loading: boolean;
  summary: ReturnType<typeof useQrScans>['data'];
}) {
  if (loading || !summary) {
    return <div className="rounded-xl bg-gray-100 animate-pulse h-40" />;
  }
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="text-[11px] uppercase tracking-widest font-bold text-gray-500">
          Scan dashboard
        </div>
        <a
          href={qrScansCsvUrl(codeId)}
          className="inline-flex items-center gap-1 text-[12px] text-gray-500 hover:text-brand-700 hover:underline"
        >
          <FileSpreadsheet className="w-3.5 h-3.5" />
          Download CSV
        </a>
      </div>

      {/* Stat strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-gray-100 border border-gray-100 rounded-xl bg-gray-50/60">
        <Stat label="Total scans" value={summary.total.toString()} />
        <Stat label="Last 7 days" value={summary.last7d.toString()} />
        <Stat label="Unique IPs" value={summary.uniqueIps.toString()} />
        <Stat
          label="Last scan"
          value={summary.mostRecentScanAt ? relativeFromIso(summary.mostRecentScanAt) : '—'}
        />
      </div>

      {/* Sparkline + top countries */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="md:col-span-2 rounded-xl border border-gray-200 bg-white p-4">
          <div className="text-[11px] uppercase tracking-widest font-bold text-gray-500 mb-2">
            Scans · last 30 days
          </div>
          <Sparkline buckets={summary.dailyBuckets} />
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="text-[11px] uppercase tracking-widest font-bold text-gray-500 mb-2">
            Top countries
          </div>
          {summary.topCountries.length === 0 ? (
            <div className="text-[12px] text-gray-400 italic">No geo data yet.</div>
          ) : (
            <ul className="space-y-1.5">
              {summary.topCountries.map((c) => (
                <li key={c.countryCode} className="flex items-center gap-2">
                  <span className="text-[10px] uppercase tracking-wider font-bold text-gray-500 w-8 tabular-nums">
                    {c.countryCode}
                  </span>
                  <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-brand-500 rounded-full"
                      style={{
                        width: `${Math.min(100, (c.count / Math.max(1, summary.topCountries[0]!.count)) * 100)}%`,
                      }}
                    />
                  </div>
                  <span className="text-[11px] tabular-nums text-gray-600 w-8 text-right">{c.count}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Recent scans */}
      <RecentScans scans={summary.recentScans} />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-3 py-3 text-center">
      <div className="text-[18px] font-bold text-gray-900 tabular-nums leading-tight">{value}</div>
      <div className="mt-0.5 text-[10px] uppercase tracking-widest font-semibold text-gray-400">
        {label}
      </div>
    </div>
  );
}

function Sparkline({ buckets }: { buckets: { date: string; count: number }[] }) {
  const max = Math.max(1, ...buckets.map((b) => b.count));
  return (
    <div className="flex items-end gap-1 h-14">
      {buckets.map((b) => (
        <div
          key={b.date}
          className="flex-1 bg-brand-500 rounded-sm transition-all"
          style={{ height: `${(b.count / max) * 100}%`, minHeight: b.count > 0 ? 2 : 1, opacity: b.count > 0 ? 1 : 0.15 }}
          title={`${b.date} · ${b.count} ${b.count === 1 ? 'scan' : 'scans'}`}
        />
      ))}
    </div>
  );
}

function RecentScans({ scans }: { scans: QrScanRow[] }) {
  if (scans.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 p-6 text-center">
        <div className="font-semibold text-gray-700">No scans yet</div>
        <p className="mt-1 text-sm text-gray-500">Share the tracking URL or download the QR.</p>
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-[11px] uppercase text-gray-400 border-b border-gray-100">
            <tr>
              <th className="px-3 py-2">Time</th>
              <th className="px-3 py-2">Location</th>
              <th className="px-3 py-2">Browser</th>
              <th className="px-3 py-2">OS</th>
              <th className="px-3 py-2">Device</th>
              <th className="px-3 py-2">IP</th>
              <th className="px-3 py-2">Referer</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {scans.map((s) => {
              const loc =
                s.city && s.countryCode
                  ? `${s.city}, ${s.countryCode}`
                  : s.countryCode || '—';
              return (
                <tr key={s.id} className="hover:bg-gray-50">
                  <td className="px-3 py-2 text-gray-700 whitespace-nowrap" title={s.scannedAt}>
                    {relativeFromIso(s.scannedAt)}
                  </td>
                  <td className="px-3 py-2 text-gray-700 whitespace-nowrap">{loc}</td>
                  <td className="px-3 py-2 text-gray-700">{s.browser ?? '—'}</td>
                  <td className="px-3 py-2 text-gray-700">{s.os ?? '—'}</td>
                  <td className="px-3 py-2 text-gray-700">{s.device ?? '—'}</td>
                  <td className="px-3 py-2 text-gray-500 font-mono text-[11px]">{s.ip ?? '—'}</td>
                  <td className="px-3 py-2 text-gray-500 max-w-[180px] truncate" title={s.referer ?? ''}>
                    {s.referer ?? '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
