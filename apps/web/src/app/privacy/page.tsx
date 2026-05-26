'use client';

import { useEffect, useState } from 'react';
import { marked } from 'marked';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { API_URL } from '@/lib/env';

/**
 * Public Privacy Policy page — mirror of /terms. See that file for the
 * intentional duplication: the two surfaces are short enough that
 * extracting a shared shell would add more indirection than it saves, and
 * keeps each URL's source easy to read on its own.
 */
export default function PrivacyPage() {
  return <PolicyPage kind="privacy" title="Privacy Policy" />;
}

function PolicyPage({ kind, title }: { kind: 'terms' | 'privacy'; title: string }) {
  const [content, setContent] = useState<string | null>(null);
  const [status, setStatus] = useState<'loading' | 'ok' | 'missing' | 'error'>('loading');

  useEffect(() => {
    let abort = false;
    (async () => {
      try {
        const res = await fetch(`${API_URL}/api/policies/${kind}`);
        if (!abort) {
          if (res.status === 404) setStatus('missing');
          else if (!res.ok) setStatus('error');
          else {
            const data = (await res.json()) as { content: string };
            setContent(data.content);
            setStatus('ok');
          }
        }
      } catch {
        if (!abort) setStatus('error');
      }
    })();
    return () => {
      abort = true;
    };
  }, [kind]);

  const html = content
    ? marked.parse(content, { async: false, breaks: true, gfm: true })
    : '';

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-100 py-12 px-6">
      <div className="max-w-3xl mx-auto">
        <Card className="p-10">
          <div className="mb-6 flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-brand-600 to-brand-700 flex items-center justify-center text-white text-lg font-bold shadow-md">
              A
            </div>
            <h1 className="text-2xl font-bold text-gray-900">{title}</h1>
          </div>

          {status === 'loading' && (
            <div className="text-sm text-gray-500">Loading…</div>
          )}
          {status === 'missing' && (
            <div className="text-sm text-gray-500">
              This workspace hasn't published a {title.toLowerCase()} yet.
            </div>
          )}
          {status === 'error' && (
            <div className="text-sm text-red-600">
              Couldn't load the {title.toLowerCase()}. Please try again later.
            </div>
          )}
          {status === 'ok' && (
            <article
              className="prose prose-sm prose-gray max-w-none prose-headings:font-bold prose-h1:text-2xl prose-h2:text-xl prose-h3:text-lg prose-a:text-brand-700 prose-a:underline prose-code:text-brand-700 prose-code:bg-brand-50 prose-code:px-1 prose-code:rounded"
              // eslint-disable-next-line react/no-danger
              dangerouslySetInnerHTML={{ __html: html }}
            />
          )}

          <div className="mt-8 pt-4 border-t border-gray-100">
            <a href="/login">
              <Button variant="ghost" size="sm">
                ← Back to sign in
              </Button>
            </a>
          </div>
        </Card>
      </div>
    </div>
  );
}
