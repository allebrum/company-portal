'use client';

import { useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { FileText, ExternalLink } from 'lucide-react';
import { usePortalMe, usePortalFiles } from '@/hooks/usePortal';
import { PortalHeader } from '@/components/portal/PortalHeader';

export default function PortalFilesPage() {
  const params = useParams<{ slug: string }>();
  const slug = params.slug;
  const router = useRouter();
  const meQuery = usePortalMe();
  const me = meQuery.data ?? null;
  const files = usePortalFiles(!!me);

  useEffect(() => {
    if (!meQuery.isLoading && !me) router.replace(`/portal/${slug}/login`);
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
            <div className="font-semibold text-gray-700">No files yet</div>
            <p className="mt-1 text-sm text-gray-500">
              Your team will add docs as the work progresses.
            </p>
          </div>
        ) : (
          <ul className="rounded-2xl border border-gray-200 bg-white divide-y divide-gray-100">
            {files.data.map((f) => (
              <li key={f.id} className="px-4 py-3 flex items-center gap-3">
                <FileText className="w-5 h-5 text-gray-400 shrink-0" />
                <a
                  href={f.url}
                  target="_blank"
                  rel="noreferrer"
                  className="flex-1 min-w-0 text-sm font-semibold text-gray-900 hover:text-brand-700 truncate"
                  title={f.url}
                >
                  {f.title}
                </a>
                <span className="text-[11px] text-gray-400 hidden sm:inline">{f.addedAt}</span>
                <ExternalLink className="w-3.5 h-3.5 text-gray-300" />
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
