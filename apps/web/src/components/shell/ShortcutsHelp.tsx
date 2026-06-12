'use client';

import { useEffect, useState } from 'react';
import { Modal } from '@/components/ui/Modal';

// Single-key shortcuts (Gmail/Linear style) — they only fire outside of
// inputs and never collide with browser combos the way the old
// Cmd/Ctrl+Shift+T (reopen tab) / +N (incognito) bindings did.
const SHORTCUTS: { keys: string; label: string }[] = [
  { keys: 'T', label: 'Start the timer' },
  { keys: 'N', label: 'New to-do (from the to-dos page)' },
  { keys: 'Enter', label: 'Quick-add a to-do from the dashboard / to-dos bar' },
  { keys: '⇧Enter', label: 'Quick-add with details (opens the composer)' },
  { keys: 'Cmd/Ctrl+Enter', label: 'Save & close the composer' },
  { keys: 'Esc', label: 'Close dialogs and overlays' },
  { keys: '?', label: 'Show this help' },
];

/**
 * Global "?" keyboard-shortcuts reference. The shortcuts existed but were
 * invisible — this makes them discoverable from anywhere in the shell.
 * Mounted once in the authenticated shell; ignores keypresses while the
 * user is typing in an input/textarea/contenteditable.
 */
export function ShortcutsHelp() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '?' || e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target && (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable)) return;
      e.preventDefault();
      setOpen((v) => !v);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <Modal open={open} onClose={() => setOpen(false)} title="Keyboard shortcuts" size="sm">
      <ul className="space-y-2.5">
        {SHORTCUTS.map((s) => (
          <li key={s.keys} className="flex items-center justify-between gap-4 text-sm text-gray-700">
            <span>{s.label}</span>
            <kbd className="kbd whitespace-nowrap">{s.keys}</kbd>
          </li>
        ))}
      </ul>
    </Modal>
  );
}
