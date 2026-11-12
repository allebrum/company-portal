'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  KeyRound, Eye, EyeOff, Copy, Pencil, Trash2, Plus, ShieldCheck, ScrollText, Lock, AlertTriangle,
} from 'lucide-react';
import {
  CREDENTIAL_KINDS,
  CREDENTIAL_KIND_LABELS,
  type CredentialKind,
  type CredentialReveal,
  type CredentialRow,
} from '@allebrum/shared';
import {
  revealCredential,
  useCreateCredential,
  useCredentialAccessLog,
  useCredentialAllowlist,
  useCredentials,
  useDeleteCredential,
  useSetCredentialAllowlist,
  useUpdateCredential,
  type CredScope,
} from '@/hooks/useCredentials';
import { useUsers } from '@/hooks/useResources';
import { ApiError } from '@/lib/api';
import { useToast } from '@/components/ui/Toast';
import { useConfirm } from '@/components/ui/ConfirmDialog';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Pill } from '@/components/ui/Pill';
import { Field, Input, Select, Textarea } from '@/components/ui/Field';

/**
 * Project / client credentials vault tab.
 *
 * - The list is metadata only; secrets are masked.
 * - "Reveal" calls POST /credentials/:id/reveal (audited server-side) and
 *   keeps the value in this row's state for REVEAL_MS, then wipes it.
 * - "Copy" writes to the clipboard and clears it again after CLIPBOARD_MS
 *   (best effort — browsers may refuse once the tab loses focus).
 * - Client scope rolls up the client's own credentials plus every project's.
 */

const REVEAL_MS = 30_000;
const CLIPBOARD_MS = 30_000;

const KIND_TONE: Record<CredentialKind, 'gray' | 'purple' | 'blue' | 'green' | 'yellow' | 'orange' | 'teal' | 'pink'> = {
  server: 'purple',
  ssh: 'blue',
  database: 'green',
  hosting: 'teal',
  registrar: 'yellow',
  email: 'pink',
  api_key: 'orange',
  other: 'gray',
};

function errMsg(e: unknown, fallback: string): string {
  if (e instanceof ApiError) {
    const code = (e.body as { error?: string } | undefined)?.error;
    if (code === 'credentials_not_configured') return 'Credentials aren\u2019t configured on the server yet.';
    if (code === 'rate_limited') return 'Too many reveals — wait a few minutes and try again.';
    if (code === 'forbidden') return 'You don\u2019t have access to do that.';
    if (code === 'invalid_totp_secret') return 'That 2FA secret isn\u2019t a valid base32 seed or otpauth:// link.';
    if (code === 'owner_only_permission_change') return 'Only an Owner can change that.';
    if (code) return code.replace(/_/g, ' ');
  }
  return fallback;
}

/** While one of our modals is open, stop the Space overlay's ESC from closing the whole Space. */
function useClaimSpaceEsc() {
  useEffect(() => {
    document.body.setAttribute('data-space-modal-open', '1');
    return () => document.body.removeAttribute('data-space-modal-open');
  }, []);
}

let clipboardTimer: number | null = null;
async function copyWithClear(value: string, toast: ReturnType<typeof useToast>, what: string) {
  try {
    await navigator.clipboard.writeText(value);
    toast.success(`${what} copied — clipboard clears in 30s`);
    if (clipboardTimer) window.clearTimeout(clipboardTimer);
    clipboardTimer = window.setTimeout(() => {
      navigator.clipboard.writeText('').catch(() => undefined);
      clipboardTimer = null;
    }, CLIPBOARD_MS);
  } catch {
    toast.error('Couldn\u2019t copy — your browser blocked clipboard access');
  }
}

export function CredentialsTab({
  scope,
  clientId,
  clientName,
}: {
  scope: CredScope;
  clientId: string;
  clientName: string;
}) {
  const list = useCredentials(scope, true);
  const [editing, setEditing] = useState<CredentialRow | 'new' | null>(null);
  const [showAccess, setShowAccess] = useState(false);
  const [showLog, setShowLog] = useState(false);

  if (list.isLoading) return <div className="rounded-xl bg-gray-100 animate-pulse h-40" />;
  if (list.isError || !list.data) {
    return (
      <div className="rounded-xl border border-gray-200 p-6 text-sm text-gray-600">
        <Lock className="w-4 h-4 inline mr-1.5 -mt-0.5" />
        {errMsg(list.error, 'You don\u2019t have access to credentials here.')}
      </div>
    );
  }
  const { access, credentials } = list.data;
  const grouped = groupByProject(credentials, scope.kind === 'client');

  return (
    <div className="space-y-4 max-w-5xl">
      <div className="flex items-start gap-3">
        <div className="flex-1">
          <h2 className="text-base font-bold text-gray-900 flex items-center gap-2">
            <KeyRound className="w-4 h-4 text-brand-600" /> Credentials
          </h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Encrypted at rest. Passwords stay hidden until you reveal them, and every reveal is logged.
            {scope.kind === 'client'
              ? ' Includes credentials from all of this client\u2019s projects.'
              : ` Who can see these follows ${clientName}\u2019s access list.`}
            {access.viaAllowlist && ' You have access because you\u2019re on this client\u2019s list.'}
          </p>
        </div>
        {access.canManageAccess && (
          <>
            <Button variant="outline" size="sm" onClick={() => setShowAccess(true)}>
              <ShieldCheck className="w-3.5 h-3.5" /> Who can see these
            </Button>
            <Button variant="outline" size="sm" onClick={() => setShowLog(true)}>
              <ScrollText className="w-3.5 h-3.5" /> Access log
            </Button>
          </>
        )}
        {access.canManage && access.configured && (
          <Button size="sm" onClick={() => setEditing('new')}>
            <Plus className="w-3.5 h-3.5" /> Add credential
          </Button>
        )}
      </div>

      {!access.configured && (
        <div className="rounded-xl border border-yellow-200 bg-yellow-50 p-4 text-sm text-yellow-900 flex gap-2">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <div>
            <div className="font-semibold">Credentials aren&apos;t configured on this server</div>
            <div className="text-xs mt-0.5">
              An admin needs to set <code>CREDENTIALS_KEYS</code> and <code>CREDENTIALS_ACTIVE_KID</code> on the
              API service before credentials can be saved or revealed.
            </div>
          </div>
        </div>
      )}

      {credentials.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-200 p-8 text-center text-sm text-gray-500">
          No credentials stored here yet.
        </div>
      ) : (
        grouped.map((g) => (
          <section key={g.key} className="space-y-2">
            {scope.kind === 'client' && (
              <h3 className="text-[11px] font-bold uppercase tracking-wider text-gray-500">{g.title}</h3>
            )}
            <div className="rounded-xl border border-gray-200 divide-y divide-gray-100 bg-white">
              {g.rows.map((c) => (
                <CredentialItem
                  key={c.id}
                  c={c}
                  canReveal={access.canReveal && access.configured}
                  canManage={access.canManage && access.configured}
                  onEdit={() => setEditing(c)}
                />
              ))}
            </div>
          </section>
        ))
      )}

      {editing && (
        <CredentialFormModal
          scope={scope}
          initial={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
      {showAccess && <AllowlistModal clientId={clientId} clientName={clientName} onClose={() => setShowAccess(false)} />}
      {showLog && <AccessLogModal clientId={clientId} clientName={clientName} onClose={() => setShowLog(false)} />}
    </div>
  );
}

function groupByProject(rows: CredentialRow[], rollup: boolean) {
  if (!rollup) return [{ key: 'all', title: '', rows }];
  const map = new Map<string, { key: string; title: string; rows: CredentialRow[] }>();
  for (const r of rows) {
    const key = r.projectId ?? 'client';
    const title = r.projectId ? `Project · ${r.projectName ?? 'Untitled'}` : 'Client-wide';
    if (!map.has(key)) map.set(key, { key, title, rows: [] });
    map.get(key)!.rows.push(r);
  }
  return [...map.values()].sort((a, b) => (a.key === 'client' ? -1 : b.key === 'client' ? 1 : a.title.localeCompare(b.title)));
}

function CredentialItem({
  c,
  canReveal,
  canManage,
  onEdit,
}: {
  c: CredentialRow;
  canReveal: boolean;
  canManage: boolean;
  onEdit: () => void;
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const del = useDeleteCredential();
  const [revealed, setRevealed] = useState<CredentialReveal | null>(null);
  const [left, setLeft] = useState(0);
  const [busy, setBusy] = useState(false);
  const timer = useRef<number | null>(null);

  const hide = () => {
    setRevealed(null);
    setLeft(0);
    if (timer.current) window.clearInterval(timer.current);
    timer.current = null;
  };
  // Wipe on unmount (tab switch / overlay close).
  useEffect(() => hide, []);

  const reveal = async () => {
    setBusy(true);
    try {
      const r = await revealCredential(c.id);
      setRevealed(r);
      const until = Date.now() + REVEAL_MS;
      setLeft(Math.ceil(REVEAL_MS / 1000));
      if (timer.current) window.clearInterval(timer.current);
      timer.current = window.setInterval(() => {
        const s = Math.ceil((until - Date.now()) / 1000);
        if (s <= 0) hide();
        else setLeft(s);
      }, 500);
    } catch (e) {
      toast.error(errMsg(e, 'Couldn\u2019t reveal this credential'));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!(await confirm({ title: `Delete “${c.label}”?`, body: 'The stored password, notes and 2FA secret are erased.' }))) return;
    try {
      await del.mutateAsync(c.id);
      toast.success('Credential deleted');
    } catch (e) {
      toast.error(errMsg(e, 'Couldn\u2019t delete'));
    }
  };

  const hostLine = [c.host && (c.port ? `${c.host}:${c.port}` : c.host), c.url].filter(Boolean).join(' · ');

  return (
    <div className="p-3.5 flex gap-3 items-start">
      <div className="w-8 h-8 rounded-lg bg-gray-50 border border-gray-100 grid place-items-center shrink-0">
        <KeyRound className="w-4 h-4 text-gray-500" />
      </div>
      <div className="flex-1 min-w-0 space-y-1.5">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold text-sm text-gray-900">{c.label}</span>
          <Pill tone={KIND_TONE[c.kind]}>{CREDENTIAL_KIND_LABELS[c.kind]}</Pill>
          {c.hasTotp && <Pill tone="gray">2FA</Pill>}
        </div>
        {hostLine && <div className="text-xs text-gray-500 font-mono break-all">{hostLine}</div>}
        <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs items-center">
          {c.username && (
            <>
              <span className="text-gray-400 uppercase tracking-wide text-[10px] font-semibold">User</span>
              <span className="font-mono text-gray-800 flex items-center gap-1.5 min-w-0">
                <span className="truncate">{c.username}</span>
                <IconBtn title="Copy username" onClick={() => copyWithClear(c.username, toast, 'Username')}>
                  <Copy className="w-3 h-3" />
                </IconBtn>
              </span>
            </>
          )}
          {c.hasSecret && (
            <>
              <span className="text-gray-400 uppercase tracking-wide text-[10px] font-semibold">Password</span>
              <span className="font-mono text-gray-800 flex items-center gap-1.5 min-w-0">
                {revealed?.secret != null ? (
                  <span className="break-all bg-yellow-50 rounded px-1">{revealed.secret}</span>
                ) : (
                  <span className="tracking-widest text-gray-400">••••••••••</span>
                )}
                {revealed?.secret != null && (
                  <IconBtn title="Copy password" onClick={() => copyWithClear(revealed.secret!, toast, 'Password')}>
                    <Copy className="w-3 h-3" />
                  </IconBtn>
                )}
              </span>
            </>
          )}
          {revealed?.totp && (
            <>
              <span className="text-gray-400 uppercase tracking-wide text-[10px] font-semibold">2FA code</span>
              <span className="font-mono text-gray-800 flex items-center gap-1.5">
                <span className="bg-yellow-50 rounded px-1">{revealed.totp.code}</span>
                <span className="text-gray-400">({revealed.totp.expiresInSec}s)</span>
                <IconBtn title="Copy code" onClick={() => copyWithClear(revealed.totp!.code, toast, 'Code')}>
                  <Copy className="w-3 h-3" />
                </IconBtn>
              </span>
            </>
          )}
        </div>
        {revealed?.notes && (
          <pre className="text-xs whitespace-pre-wrap bg-yellow-50 rounded-lg p-2 text-gray-800 font-sans">{revealed.notes}</pre>
        )}
        {!revealed && c.hasNotes && <div className="text-[11px] text-gray-400 italic">Has private notes</div>}
        <div className="text-[11px] text-gray-400">
          {c.secretUpdatedAt ? `Password set ${new Date(c.secretUpdatedAt).toLocaleDateString()}` : 'No password stored'}
          {c.lastRevealedAt ? ` · last revealed ${new Date(c.lastRevealedAt).toLocaleString()}` : ''}
        </div>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        {canReveal && (c.hasSecret || c.hasNotes || c.hasTotp) && (
          revealed ? (
            <Button variant="outline" size="sm" onClick={hide} title="Hide now">
              <EyeOff className="w-3.5 h-3.5" /> Hide ({left}s)
            </Button>
          ) : (
            <Button variant="outline" size="sm" onClick={reveal} disabled={busy}>
              <Eye className="w-3.5 h-3.5" /> {busy ? 'Revealing…' : 'Reveal'}
            </Button>
          )
        )}
        {canManage && (
          <>
            <IconBtn title="Edit" onClick={onEdit}>
              <Pencil className="w-3.5 h-3.5" />
            </IconBtn>
            <IconBtn title="Delete" onClick={remove}>
              <Trash2 className="w-3.5 h-3.5" />
            </IconBtn>
          </>
        )}
      </div>
    </div>
  );
}

function IconBtn({ title, onClick, children }: { title: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      className="p-1.5 rounded-md text-gray-400 hover:text-gray-800 hover:bg-gray-100"
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------

type SecretState = { value: string; touched: boolean; clear: boolean };
const untouched: SecretState = { value: '', touched: false, clear: false };

function CredentialFormModal({
  scope,
  initial,
  onClose,
}: {
  scope: CredScope;
  initial: CredentialRow | null;
  onClose: () => void;
}) {
  useClaimSpaceEsc();
  const toast = useToast();
  const create = useCreateCredential();
  const update = useUpdateCredential();
  const [label, setLabel] = useState(initial?.label ?? '');
  const [kind, setKind] = useState<CredentialKind>(initial?.kind ?? 'server');
  const [host, setHost] = useState(initial?.host ?? '');
  const [port, setPort] = useState(initial?.port ? String(initial.port) : '');
  const [url, setUrl] = useState(initial?.url ?? '');
  const [username, setUsername] = useState(initial?.username ?? '');
  const [secret, setSecret] = useState<SecretState>(untouched);
  const [notes, setNotes] = useState<SecretState>(untouched);
  const [totp, setTotp] = useState<SecretState>(untouched);
  const [showPw, setShowPw] = useState(false);
  const saving = create.isPending || update.isPending;

  const secretPatch = (s: SecretState) => (s.clear ? '' : s.touched && s.value ? s.value : undefined);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const portNum = port.trim() ? Number(port) : null;
    if (portNum !== null && (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535)) {
      toast.error('Port must be a number between 1 and 65535');
      return;
    }
    try {
      if (initial) {
        await update.mutateAsync({
          id: initial.id,
          patch: {
            label, kind, host, port: portNum, url, username,
            secret: secretPatch(secret),
            notes: secretPatch(notes),
            totpSecret: secretPatch(totp),
          },
        });
        toast.success('Credential updated');
      } else {
        await create.mutateAsync({
          ...(scope.kind === 'client' ? { clientId: scope.id } : { projectId: scope.id }),
          label, kind, host, port: portNum, url, username,
          secret: secret.value, notes: notes.value, totpSecret: totp.value,
        });
        toast.success('Credential saved');
      }
      onClose();
    } catch (err) {
      toast.error(errMsg(err, 'Couldn\u2019t save'));
    }
  };

  const secretField = (
    labelText: string,
    s: SecretState,
    set: (s: SecretState) => void,
    has: boolean | undefined,
    render: (props: { value: string; onChange: (v: string) => void; placeholder: string }) => React.ReactNode,
  ) => (
    <Field
      as="div"
      label={labelText}
      hint={initial && has ? (s.clear ? 'Will be removed when you save.' : 'Stored — leave blank to keep it.') : undefined}
    >
      {render({
        value: s.value,
        onChange: (v) => set({ value: v, touched: true, clear: false }),
        placeholder: initial && has ? '•••••••• (unchanged)' : '',
      })}
      {initial && has && (
        <button
          type="button"
          className="text-[11px] text-red-600 hover:underline"
          onClick={() => set({ value: '', touched: true, clear: !s.clear })}
        >
          {s.clear ? 'Keep stored value' : 'Remove stored value'}
        </button>
      )}
    </Field>
  );

  return (
    <Modal
      open
      onClose={onClose}
      title={initial ? `Edit ${initial.label}` : 'Add credential'}
      size="lg"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} type="button">Cancel</Button>
          <Button type="submit" form="cred-form" disabled={saving || !label.trim()}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      }
    >
      <form id="cred-form" onSubmit={submit} className="grid grid-cols-2 gap-3" autoComplete="off">
        <Field label="Label" required className="col-span-2">
          <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Production server root" autoFocus />
        </Field>
        <Field label="Kind">
          <Select value={kind} onChange={(e) => setKind(e.target.value as CredentialKind)}>
            {CREDENTIAL_KINDS.map((k) => (
              <option key={k} value={k}>{CREDENTIAL_KIND_LABELS[k]}</option>
            ))}
          </Select>
        </Field>
        <Field label="Username">
          <Input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="root" autoComplete="off" />
        </Field>
        <Field label="Host / IP">
          <Input value={host} onChange={(e) => setHost(e.target.value)} placeholder="203.0.113.10" />
        </Field>
        <Field label="Port">
          <Input value={port} onChange={(e) => setPort(e.target.value)} placeholder="22" inputMode="numeric" />
        </Field>
        <Field label="URL" className="col-span-2">
          <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://cloud.digitalocean.com/…" />
        </Field>
        <div className="col-span-2">
          {secretField('Password / key', secret, setSecret, initial?.hasSecret, (p) => (
            <div className="flex gap-2">
              <Input
                type={showPw ? 'text' : 'password'}
                value={p.value}
                onChange={(e) => p.onChange(e.target.value)}
                placeholder={p.placeholder}
                autoComplete="new-password"
                className="font-mono"
              />
              <Button type="button" variant="outline" onClick={() => setShowPw((v) => !v)} title={showPw ? 'Hide' : 'Show'}>
                {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </Button>
            </div>
          ))}
        </div>
        <div className="col-span-2">
          {secretField('Private notes (encrypted)', notes, setNotes, initial?.hasNotes, (p) => (
            <Textarea rows={3} value={p.value} onChange={(e) => p.onChange(e.target.value)} placeholder={p.placeholder || 'SSH key passphrase, recovery codes, …'} />
          ))}
        </div>
        <div className="col-span-2">
          {secretField('2FA secret (optional)', totp, setTotp, initial?.hasTotp, (p) => (
            <Input value={p.value} onChange={(e) => p.onChange(e.target.value)} placeholder={p.placeholder || 'Base32 seed or otpauth:// link — shows the current code on reveal'} autoComplete="off" className="font-mono" />
          ))}
        </div>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------

function AllowlistModal({ clientId, clientName, onClose }: { clientId: string; clientName: string; onClose: () => void }) {
  useClaimSpaceEsc();
  const toast = useToast();
  const { data: users = [] } = useUsers();
  const allow = useCredentialAllowlist(clientId, true);
  const save = useSetCredentialAllowlist();
  const [state, setState] = useState<Record<string, 'none' | 'view' | 'manage'>>({});
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (allow.data && !loaded) {
      const s: Record<string, 'none' | 'view' | 'manage'> = {};
      for (const e of allow.data.entries) s[e.userId] = e.canManage ? 'manage' : 'view';
      setState(s);
      setLoaded(true);
    }
  }, [allow.data, loaded]);

  const active = useMemo(() => users.filter((u) => u.status !== 'removed'), [users]);
  const always = useMemo(() => new Set(allow.data?.workspaceWideUserIds ?? []), [allow.data]);

  const submit = async () => {
    const entries = Object.entries(state)
      .filter(([id, v]) => v !== 'none' && !always.has(id))
      .map(([userId, v]) => ({ userId, canManage: v === 'manage' }));
    try {
      await save.mutateAsync({ clientId, entries });
      toast.success('Access updated');
      onClose();
    } catch (e) {
      toast.error(errMsg(e, 'Couldn\u2019t update access'));
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`Who can see ${clientName}\u2019s credentials`}
      size="lg"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={save.isPending || !loaded}>{save.isPending ? 'Saving…' : 'Save'}</Button>
        </div>
      }
    >
      <p className="text-xs text-gray-500 mb-3">
        Owners always have access. Everyone else — including Admins — sees nothing unless you add them here.
        Access covers this client and all of its projects.
      </p>
      <div className="rounded-xl border border-gray-200 divide-y divide-gray-100">
        {active.map((u) => (
          <div key={u.id} className="flex items-center gap-3 px-3 py-2">
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-gray-900 truncate">{u.name}</div>
              <div className="text-[11px] text-gray-500 truncate">{u.email}</div>
            </div>
            {always.has(u.id) ? (
              <span className="w-52 text-right text-xs font-semibold text-brand-700">Owner — always has access</span>
            ) : (
              <Select
                value={state[u.id] ?? 'none'}
                onChange={(e) => setState((s) => ({ ...s, [u.id]: e.target.value as 'none' | 'view' | 'manage' }))}
                className="w-52"
                aria-label={`Access for ${u.name}`}
              >
                <option value="none">No access</option>
                <option value="view">Can view &amp; reveal</option>
                <option value="manage">Can view, reveal &amp; edit</option>
              </Select>
            )}
          </div>
        ))}
      </div>
    </Modal>
  );
}

const OUTCOME_TONE = { ok: 'green', denied: 'red', not_found: 'gray', rate_limited: 'orange', not_configured: 'yellow', decrypt_failed: 'red' } as const;

function AccessLogModal({ clientId, clientName, onClose }: { clientId: string; clientName: string; onClose: () => void }) {
  useClaimSpaceEsc();
  const log = useCredentialAccessLog(clientId, true);
  const { data: users = [] } = useUsers();
  const nameOf = (id: string | null) => users.find((u) => u.id === id)?.name ?? (id ? 'Former member' : '—');
  return (
    <Modal open onClose={onClose} title={`Credentials access log — ${clientName}`} size="3xl">
      {log.isLoading ? (
        <div className="h-32 rounded-xl bg-gray-100 animate-pulse" />
      ) : (log.data ?? []).length === 0 ? (
        <div className="text-sm text-gray-500">No activity yet.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-left text-gray-500 uppercase tracking-wide text-[10px]">
              <tr>
                <th className="py-1.5 pr-3">When</th>
                <th className="py-1.5 pr-3">Who</th>
                <th className="py-1.5 pr-3">Action</th>
                <th className="py-1.5 pr-3">Credential</th>
                <th className="py-1.5 pr-3">Result</th>
                <th className="py-1.5">IP</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {(log.data ?? []).map((r) => (
                <tr key={r.id}>
                  <td className="py-1.5 pr-3 whitespace-nowrap text-gray-600">{new Date(r.createdAt).toLocaleString()}</td>
                  <td className="py-1.5 pr-3">
                    {nameOf(r.userId)}
                    {r.tokenName && <span className="text-gray-400"> via token “{r.tokenName}”</span>}
                  </td>
                  <td className="py-1.5 pr-3">{r.action}</td>
                  <td className="py-1.5 pr-3">{r.label}</td>
                  <td className="py-1.5 pr-3"><Pill tone={OUTCOME_TONE[r.outcome]}>{r.outcome.replace('_', ' ')}</Pill></td>
                  <td className="py-1.5 font-mono text-gray-500">{r.ip ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}
