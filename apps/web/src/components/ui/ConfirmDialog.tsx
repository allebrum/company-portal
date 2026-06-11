'use client';

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';

export type ConfirmOptions = {
  title: string;
  /** Body copy explaining the consequence. Keep it to one or two sentences. */
  body?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Destructive styling on the confirm button (red). Default true — most confirms guard deletes. */
  danger?: boolean;
};

type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

/**
 * App-wide styled replacement for `window.confirm()`. Call sites stay
 * imperative — `if (!(await confirm({ title: 'Delete entry?' }))) return;` —
 * while the dialog renders as a branded Modal (focus-trapped, Escape to
 * cancel) instead of the unstyled native browser popup.
 */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<ConfirmOptions | null>(null);
  // The resolver lives in a ref so re-renders never orphan the promise.
  const resolveRef = useRef<((v: boolean) => void) | null>(null);

  const confirm = useCallback<ConfirmFn>((opts) => {
    return new Promise<boolean>((resolve) => {
      // If a confirm is somehow already open, settle it as cancelled first.
      resolveRef.current?.(false);
      resolveRef.current = resolve;
      setPending(opts);
    });
  }, []);

  const settle = (v: boolean) => {
    resolveRef.current?.(v);
    resolveRef.current = null;
    setPending(null);
  };

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Modal
        open={!!pending}
        onClose={() => settle(false)}
        title={pending?.title}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => settle(false)}>
              {pending?.cancelLabel ?? 'Cancel'}
            </Button>
            <Button
              variant={(pending?.danger ?? true) ? 'danger' : 'primary'}
              onClick={() => settle(true)}
              autoFocus
            >
              {pending?.confirmLabel ?? 'Confirm'}
            </Button>
          </>
        }
      >
        <div className="text-sm text-gray-700">{pending?.body ?? 'This action can’t be undone.'}</div>
      </Modal>
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error('useConfirm must be used inside ConfirmProvider');
  return ctx;
}
