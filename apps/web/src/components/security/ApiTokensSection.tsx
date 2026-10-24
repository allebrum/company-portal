'use client';

import { useState } from 'react';
import { Bot, Copy, Trash2 } from 'lucide-react';
import { API_TOKEN_SCOPES, type ApiTokenScope, type ApiTokenSummary } from '@allebrum/shared';
import { Card, Section, Pill, Empty } from '@/components/ui';
import { Button } from '@/components/ui/Button';
import { Checkbox, Field, Input, Select } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import { useApiTokens, useCreateApiToken, useRevokeApiToken } from '@/hooks/useApiTokens';

const SCOPE_LABEL: Record<ApiTokenScope, string> = {
  read: 'Read clients, projects, notes & time',
  'notes:write': 'Add notes to client/project Spaces (append-only)',
  'time:write': 'Start/stop timers and log time',
};

function tokenState(t: ApiTokenSummary): { label: string; tone: 'green' | 'gray' | 'red' } {
  if (t.revokedAt) return { label: 'Revoked', tone: 'gray' };
  if (t.expiresAt && new Date(t.expiresAt.replace(' ', 'T')).getTime() <= Date.now()) return { label: 'Expired', tone: 'red' };
  return { label: 'Active', tone: 'green' };
}

const day = (s: string | null) => (s ? s.slice(0, 10) : '—');

/**
 * Personal access tokens for bots/scripts (see docs/BOT_API.md). Tokens act
 * as you, limited to the chosen scopes. The secret is shown exactly once.
 */
export function ApiTokensSection() {
  const toast = useToast();
  const { data: tokens } = useApiTokens();
  const create = useCreateApiToken();
  const revoke = useRevokeApiToken();

  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<ApiTokenScope[]>(['read', 'notes:write', 'time:write']);
  const [expires, setExpires] = useState<string>('90');
  const [secret, setSecret] = useState<string | null>(null);

  const toggle = (s: ApiTokenScope, on: boolean) =>
    setScopes((prev) => (on ? Array.from(new Set([...prev, s])) : prev.filter((x) => x !== s)));

  const submit = async () => {
    try {
      const created = await create.mutateAsync({
        name: name.trim(),
        scopes,
        expiresInDays: expires === 'never' ? null : Number(expires),
      });
      setSecret(created.token);
      setName('');
    } catch (e) {
      toast.error(e instanceof Error && e.message.includes('too_many_tokens') ? 'Token limit reached — revoke an old one first' : 'Could not create token');
    }
  };

  const onRevoke = async (t: ApiTokenSummary) => {
    if (!window.confirm(`Revoke “${t.name}”? Anything using it will stop working immediately.`)) return;
    try {
      await revoke.mutateAsync(t.id);
      toast.success('Token revoked');
    } catch {
      toast.error('Could not revoke token');
    }
  };

  return (
    <Section title="API tokens">
      <Card className="p-5 space-y-4 max-w-xl">
        <p className="text-sm text-gray-600">
          Let a bot or script add notes and track time as you. Tokens can only reach a few endpoints, never more than
          you can do yourself.
        </p>

        {secret ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 space-y-3">
            <div className="text-sm font-semibold text-amber-900">Copy your new token</div>
            <p className="text-[12px] text-amber-800">It won&apos;t be shown again. Treat it like a password.</p>
            <code className="block break-all rounded bg-white px-2 py-1.5 font-mono text-[12px] text-gray-900 border border-amber-200">
              {secret}
            </code>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  navigator.clipboard?.writeText(secret).then(() => toast.success('Copied'), () => undefined)
                }
              >
                <Copy className="w-3.5 h-3.5" /> Copy
              </Button>
              <Button variant="primary" size="sm" onClick={() => setSecret(null)}>
                Done
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-end gap-2">
              <Field label="Name" className="flex-1">
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Grok bot" maxLength={80} />
              </Field>
              <Field label="Expires">
                <Select value={expires} onChange={(e) => setExpires(e.target.value)} className="w-32">
                  <option value="30">30 days</option>
                  <option value="90">90 days</option>
                  <option value="365">1 year</option>
                  <option value="never">Never</option>
                </Select>
              </Field>
            </div>
            <div className="flex flex-col gap-1.5">
              {API_TOKEN_SCOPES.map((s) => (
                <Checkbox key={s} label={SCOPE_LABEL[s]} checked={scopes.includes(s)} onChange={(v) => toggle(s, v)} />
              ))}
            </div>
            <Button variant="primary" onClick={submit} disabled={!name.trim() || scopes.length === 0 || create.isPending}>
              <Bot className="w-4 h-4" /> Create token
            </Button>
          </div>
        )}
      </Card>

      <Card className="mt-3 max-w-xl">
        {!tokens || tokens.length === 0 ? (
          <div className="p-5">
            <Empty title="No API tokens" description="Create one above to connect a bot." />
          </div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {tokens.map((t) => {
              const st = tokenState(t);
              return (
                <li key={t.id} className="px-5 py-3 flex items-center gap-3">
                  <Bot className="w-4 h-4 text-brand-600 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-gray-900 truncate">{t.name}</span>
                      <Pill tone={st.tone}>{st.label}</Pill>
                    </div>
                    <div className="text-[11px] text-gray-500">
                      <span className="font-mono">{t.prefix}…</span> · {t.scopes.join(', ')} · created {day(t.createdAt)} ·
                      last used {day(t.lastUsedAt)}
                      {t.expiresAt ? ` · expires ${day(t.expiresAt)}` : ''}
                    </div>
                  </div>
                  {!t.revokedAt && (
                    <button onClick={() => onRevoke(t)} className="text-gray-300 hover:text-red-600" title="Revoke" aria-label={`Revoke ${t.name}`}>
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </Section>
  );
}
