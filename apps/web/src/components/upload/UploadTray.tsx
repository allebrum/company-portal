'use client';

import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, RotateCcw, X } from 'lucide-react';
import { useUploadManager, type UploadItem } from '@/contexts/UploadManagerContext';
import { Button } from '@/components/ui/Button';

/**
 * Fixed-position upload progress tray. Sibling of `ClientSpaceOverlay`
 * in `AuthGate` so it persists across Space-overlay open/close, route
 * changes, and scope switches.
 *
 * Position: bottom-left, z-55 — clear of toasts (bottom-right z-60).
 * Visually a compact card; auto-collapses to a pill 5 seconds after the
 * last upload reaches a terminal state, and the whole tray dismisses
 * itself when the items array empties.
 */
export function UploadTray() {
  const { items, cancel, retry, dismiss, clearCompleted } = useUploadManager();
  const [expanded, setExpanded] = useState(false);

  // Derived counts — single pass.
  const counts = useMemo(() => {
    let queued = 0,
      uploading = 0,
      done = 0,
      failed = 0,
      cancelled = 0;
    let bytesDone = 0,
      bytesTotal = 0;
    for (const it of items) {
      bytesTotal += it.file.size;
      if (it.status === 'queued') queued++;
      else if (it.status === 'uploading') {
        uploading++;
        bytesDone += it.file.size * it.progress;
      } else if (it.status === 'done') {
        done++;
        bytesDone += it.file.size;
      } else if (it.status === 'failed') failed++;
      else if (it.status === 'cancelled') cancelled++;
    }
    const active = queued + uploading;
    const aggregatePct = bytesTotal > 0 ? Math.round((bytesDone / bytesTotal) * 100) : 0;
    return { queued, uploading, done, failed, cancelled, active, aggregatePct };
  }, [items]);

  // Auto-collapse 5 seconds after all work is done. Auto-hides when the
  // items array is empty (the user dismissed everything OR everything
  // resolved and was cleared). Re-expansion is user-driven.
  useEffect(() => {
    if (counts.active > 0) return;
    const t = setTimeout(() => setExpanded(false), 5000);
    return () => clearTimeout(t);
  }, [counts.active]);

  // Expand automatically the first time a batch lands so users see the
  // queue immediately. Only re-trigger when going from 0 → N active.
  const [wasActive, setWasActive] = useState(false);
  useEffect(() => {
    if (counts.active > 0 && !wasActive) {
      setExpanded(true);
      setWasActive(true);
    } else if (counts.active === 0 && wasActive) {
      setWasActive(false);
    }
  }, [counts.active, wasActive]);

  if (items.length === 0) return null;

  return (
    <div className="fixed bottom-4 left-4 z-[55] w-[360px] max-w-[calc(100vw-2rem)]">
      <div className="rounded-2xl border border-gray-200 bg-white shadow-xl overflow-hidden">
        {/* Header pill — clickable to expand/collapse */}
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors text-left"
        >
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-gray-900">
              {counts.active > 0
                ? `Uploading ${counts.uploading} of ${counts.uploading + counts.queued}`
                : `${counts.done} done${counts.failed ? ` · ${counts.failed} failed` : ''}${
                    counts.cancelled ? ` · ${counts.cancelled} cancelled` : ''
                  }`}
            </div>
            <div className="text-[11px] text-gray-500 mt-0.5">
              {counts.active > 0 ? `${counts.aggregatePct}%` : 'Click to review'}
            </div>
          </div>
          {expanded ? (
            <ChevronDown className="w-4 h-4 text-gray-400" />
          ) : (
            <ChevronUp className="w-4 h-4 text-gray-400" />
          )}
        </button>

        {/* Aggregate sliver — visible only while active, even when collapsed */}
        {counts.active > 0 && (
          <div className="h-1 bg-gray-100">
            <div
              className="h-full bg-brand-600 transition-all duration-200"
              style={{ width: `${counts.aggregatePct}%` }}
            />
          </div>
        )}

        {expanded && (
          <>
            <div className="max-h-[40vh] overflow-y-auto divide-y divide-gray-100">
              {items.map((item) => (
                <UploadRow
                  key={item.id}
                  item={item}
                  onCancel={() => cancel(item.id)}
                  onRetry={() => retry(item.id)}
                  onDismiss={() => dismiss(item.id)}
                />
              ))}
            </div>
            {(counts.done > 0 || counts.failed > 0 || counts.cancelled > 0) && (
              <div className="flex items-center justify-between px-4 py-2 bg-gray-50 border-t border-gray-100">
                <div className="text-[11px] text-gray-500">
                  {[
                    counts.done && `${counts.done} done`,
                    counts.failed && `${counts.failed} failed`,
                    counts.cancelled && `${counts.cancelled} cancelled`,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </div>
                <Button variant="ghost" size="sm" onClick={clearCompleted}>
                  Clear finished
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function UploadRow({
  item,
  onCancel,
  onRetry,
  onDismiss,
}: {
  item: UploadItem;
  onCancel: () => void;
  onRetry: () => void;
  onDismiss: () => void;
}) {
  const pct = Math.round(item.progress * 100);
  const isTerminal =
    item.status === 'done' || item.status === 'failed' || item.status === 'cancelled';
  return (
    <div className="px-4 py-2.5">
      <div className="flex items-center gap-2">
        <div className="flex-1 min-w-0">
          <div className="text-[13px] text-gray-900 font-medium truncate" title={item.file.name}>
            {item.file.name}
          </div>
          <div className="text-[11px] text-gray-500 truncate">{item.scopeLabel}</div>
        </div>
        <StatusPill item={item} />
        {isTerminal ? (
          <>
            {item.status === 'failed' && (
              <button
                type="button"
                onClick={onRetry}
                className="text-gray-400 hover:text-brand-700"
                aria-label="Retry"
                title="Retry"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
            )}
            <button
              type="button"
              onClick={onDismiss}
              className="text-gray-300 hover:text-gray-600"
              aria-label="Dismiss"
              title="Dismiss"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={onCancel}
            className="text-gray-300 hover:text-red-600"
            aria-label="Cancel"
            title="Cancel"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
      {item.status === 'uploading' && (
        <div className="mt-1.5">
          <div className="h-1 bg-gray-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-brand-600 transition-all duration-200"
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="text-[10px] text-gray-400 mt-0.5 tabular-nums">{pct}%</div>
        </div>
      )}
      {item.status === 'failed' && item.error && (
        <div className="mt-1 text-[11px] text-red-600 break-all">{item.error}</div>
      )}
    </div>
  );
}

function StatusPill({ item }: { item: UploadItem }) {
  const base =
    'text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded shrink-0';
  if (item.status === 'queued') return <span className={`${base} bg-gray-100 text-gray-600`}>Queued</span>;
  if (item.status === 'uploading') return <span className={`${base} bg-brand-100 text-brand-800`}>Up</span>;
  if (item.status === 'done') return <span className={`${base} bg-emerald-100 text-emerald-800`}>Done</span>;
  if (item.status === 'failed') return <span className={`${base} bg-red-100 text-red-800`}>Failed</span>;
  return <span className={`${base} bg-gray-100 text-gray-500`}>Cancelled</span>;
}
