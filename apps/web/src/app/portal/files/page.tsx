'use client';

import { Suspense, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  ExternalLink,
  File,
  FileSpreadsheet,
  FileText,
  Film,
  Image as ImageIcon,
  type LucideIcon,
} from 'lucide-react';
import { usePortalMe, usePortalFiles } from '@/hooks/usePortal';
import { PortalHeader } from '@/components/portal/PortalHeader';

// Portal file rows only carry { id, title, url, meta?, addedAt } — `meta` is a
// Drive provenance string ("Drive · <id>"), not a mime type — so the best type
// signal we have is the extension on the title (Drive uploads keep it), with
// the URL path as a fallback.
const ICON_BY_EXT: Record<string, LucideIcon> = {
  doc: FileText, docx: FileText, pdf: FileText, txt: FileText, md: FileText, rtf: FileText,
  png: ImageIcon, jpg: ImageIcon, jpeg: ImageIcon, gif: ImageIcon, webp: ImageIcon, svg: ImageIcon, heic: ImageIcon,
  xls: FileSpreadsheet, xlsx: FileSpreadsheet, csv: FileSpreadsheet, tsv: FileSpreadsheet, ods: FileSpreadsheet, numbers: FileSpreadsheet,
  mp4: Film, mov: Film, avi: Film, mkv: Film, webm: Film,
};

function extensionOf(value: string): string | null {
  return /\.([a-z0-9]+)(?:[?#].*)?$/i.exec(value)?.[1]?.toLowerCase() ?? null;
}

function fileIconFor(title: string, url: string): LucideIcon {
  const ext = extensionOf(title) ?? extensionOf(url);
  return (ext && ICON_BY_EXT[ext]) || File;
}

// addedAt is a plain "YYYY-MM-DD" string; parse it as local time so the date
// doesn't shift a day in timezones behind UTC.
function formatAddedAt(value: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  const d = m
    ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
    : new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function Inner() {
  const search = useSearchParams();
  const slug = search?.get('slug') ?? '';
  const router = useRouter();
  const meQuery = usePortalMe();
  const me = meQuery.data ?? null;
  const files = usePortalFiles(!!me);

  useEffect(() => {
    if (!meQuery.isLoading && !me) {
      router.replace(`/portal/login?slug=${encodeURIComponent(slug)}`);
    }
  }, [meQuery.isLoading, me, slug, router]);

  return (
    <>
      <PortalHeader slug={slug} me={me} active="files" />
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
        <h1 className="text-2xl font-bold text-gray-900 mb-1">Files</h1>
        <p className="text-sm text-gray-500 mb-6">
          Documents your team has attached to this engagement.
        </p>

        {!files.data ? (
          <div className="rounded-xl bg-gray-100 animate-pulse h-40" />
        ) : files.data.length === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 p-8 text-center">
            <div className="font-semibold text-gray-700">No files shared with you yet</div>
            <p className="mt-1 text-sm text-gray-500">
              Files your team shares will appear here.
            </p>
          </div>
        ) : (
          <ul className="rounded-2xl border border-gray-200 bg-white divide-y divide-gray-100">
            {files.data.map((f) => {
              const Icon = fileIconFor(f.title, f.url);
              return (
                <li key={f.id} className="px-4 py-3 flex items-center gap-3">
                  <Icon className="w-5 h-5 text-gray-400 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <a
                      href={f.url}
                      target="_blank"
                      rel="noreferrer"
                      className="block text-sm font-semibold text-gray-900 hover:text-brand-700 truncate"
                      title={f.url}
                    >
                      {f.title}
                    </a>
                    <div className="text-[11px] text-gray-500 truncate">
                      Added {formatAddedAt(f.addedAt)}
                    </div>
                  </div>
                  <ExternalLink className="w-3.5 h-3.5 text-gray-300 shrink-0" />
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </>
  );
}

export default function PortalFilesPage() {
  return (
    <Suspense fallback={<div className="text-sm text-gray-500 p-8 text-center">Loading…</div>}>
      <Inner />
    </Suspense>
  );
}
