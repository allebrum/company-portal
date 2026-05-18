'use client';

import { useState } from 'react';
import { Trash2, ShieldCheck, KeyRound } from 'lucide-react';
import { Card, Section, Pill, Empty } from '@/components/ui';
import { Button } from '@/components/ui/Button';
import { Field, Input } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import {
  useTwoFactorStatus,
  useStartTotpSetup,
  useEnableTotp,
  useDisableTotp,
  useRegenerateRecoveryCodes,
  useRegisterPasskey,
  useDeletePasskey,
} from '@/hooks/use2fa';

function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 space-y-3">
      <div className="text-sm font-semibold text-amber-900">Save your recovery codes</div>
      <p className="text-[12px] text-amber-800">
        Each code works once if you lose your authenticator. They won&apos;t be shown again.
      </p>
      <div className="grid grid-cols-2 gap-1 font-mono text-sm text-amber-900">
        {codes.map((c) => (
          <div key={c}>{c}</div>
        ))}
      </div>
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => navigator.clipboard?.writeText(codes.join('\n')).catch(() => undefined)}
        >
          Copy
        </Button>
        <Button variant="primary" size="sm" onClick={onDone}>
          I&apos;ve saved them
        </Button>
      </div>
    </div>
  );
}

export default function SecurityPage() {
  const toast = useToast();
  const { data: status } = useTwoFactorStatus();
  const startSetup = useStartTotpSetup();
  const enable = useEnableTotp();
  const disable = useDisableTotp();
  const regen = useRegenerateRecoveryCodes();
  const registerPasskey = useRegisterPasskey();
  const deletePasskey = useDeletePasskey();

  const [setup, setSetup] = useState<{ qrDataUrl: string; otpauthUrl: string } | null>(null);
  const [code, setCode] = useState('');
  const [recovery, setRecovery] = useState<string[] | null>(null);
  const [pkName, setPkName] = useState('');

  const beginSetup = async () => {
    try {
      const s = await startSetup.mutateAsync();
      setSetup(s);
      setCode('');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not start setup');
    }
  };

  const confirmEnable = async () => {
    try {
      const { recoveryCodes } = await enable.mutateAsync(code.trim());
      setSetup(null);
      setRecovery(recoveryCodes);
      toast.success('Authenticator enabled');
    } catch (e) {
      toast.error(e instanceof Error && e.message.includes('invalid') ? 'That code was incorrect' : 'Could not enable');
    }
  };

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      toast.success(ok);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Action failed');
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <div className="eyebrow">Account</div>
        <h1 className="text-2xl font-bold text-gray-900">Security</h1>
        <p className="text-sm text-gray-500">Add a second factor to protect your account.</p>
      </div>

      {status?.required && (
        <div className="rounded-lg border border-brand-200 bg-brand-50 px-4 py-3 text-sm text-brand-800 flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 shrink-0" />
          Two-factor authentication is required for your group. Set up at least one method below.
        </div>
      )}

      {recovery && (
        <Section title="Recovery codes">
          <RecoveryCodes codes={recovery} onDone={() => setRecovery(null)} />
        </Section>
      )}

      <Section title="Authenticator app (TOTP)">
        <Card className="p-5 space-y-4 max-w-xl">
          {status?.totpEnabled ? (
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-2 text-sm text-gray-800">
                <Pill tone="green">Enabled</Pill>
                Time-based codes from your authenticator app.
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    run(async () => {
                      const { recoveryCodes } = await regen.mutateAsync();
                      setRecovery(recoveryCodes);
                    }, 'New recovery codes generated')
                  }
                >
                  Regenerate recovery codes
                </Button>
                <Button variant="danger" size="sm" onClick={() => run(() => disable.mutateAsync(), 'Authenticator removed')}>
                  Disable
                </Button>
              </div>
            </div>
          ) : setup ? (
            <div className="space-y-4">
              <p className="text-sm text-gray-600">
                Scan this QR code with Google Authenticator, 1Password, Authy, etc., then enter the 6-digit code.
              </p>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={setup.qrDataUrl} alt="TOTP QR code" className="w-44 h-44 border rounded-lg" />
              <div className="flex items-end gap-2">
                <Field label="6-digit code" className="flex-1">
                  <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="123456" />
                </Field>
                <Button variant="primary" onClick={confirmEnable} disabled={!code.trim() || enable.isPending}>
                  Enable
                </Button>
                <Button variant="ghost" onClick={() => setSetup(null)}>Cancel</Button>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-4">
              <span className="text-sm text-gray-600">Not configured.</span>
              <Button variant="primary" onClick={beginSetup} disabled={startSetup.isPending}>
                Set up authenticator
              </Button>
            </div>
          )}
        </Card>
      </Section>

      <Section
        title="Passkeys"
        action={
          <div className="flex items-center gap-2">
            <Input
              className="w-44"
              value={pkName}
              onChange={(e) => setPkName(e.target.value)}
              placeholder="Device name"
            />
            <Button
              variant="primary"
              onClick={() =>
                run(async () => {
                  await registerPasskey.mutateAsync(pkName.trim() || 'Passkey');
                  setPkName('');
                }, 'Passkey added')
              }
              disabled={registerPasskey.isPending}
            >
              <KeyRound className="w-4 h-4" /> Add passkey
            </Button>
          </div>
        }
      >
        <Card>
          {!status || status.passkeys.length === 0 ? (
            <div className="p-5">
              <Empty title="No passkeys" description="Use Touch ID, Windows Hello, or a security key for passwordless 2FA." />
            </div>
          ) : (
            <ul className="divide-y divide-gray-100">
              {status.passkeys.map((p) => (
                <li key={p.id} className="px-5 py-3 flex items-center gap-3">
                  <KeyRound className="w-4 h-4 text-brand-600" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-gray-900 truncate">{p.name}</div>
                    <div className="text-[11px] text-gray-500">Added {p.createdAt.slice(0, 10)}</div>
                  </div>
                  <button
                    onClick={() => run(() => deletePasskey.mutateAsync(p.id), 'Passkey removed')}
                    className="text-gray-300 hover:text-red-600"
                    title="Remove"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </Section>
    </div>
  );
}
