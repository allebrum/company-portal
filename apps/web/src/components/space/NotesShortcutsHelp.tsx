'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { HelpCircle, X } from 'lucide-react';
import { Popover } from '@/components/ui/Popover';
import { buildNotesHelp, isHelpHotkey } from './notes/help';

const SECTIONS = buildNotesHelp();

function isTypingTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el || !el.tagName) return false;
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || el.isContentEditable;
}

/**
 * Circled "?" on the Notes canvas that opens a reference of every slash
 * command, markdown shortcut, keyboard behavior and gutter action. Content is
 * generated from the editor's own command lists (see notes/help.ts).
 *
 * Opens with the button, `?` (when not typing in a block) or Cmd/Ctrl+/
 * (anywhere on the Notes tab). Closes on Esc, outside click or the ✕; focus
 * moves into the panel on open and back to the button on close.
 */
export function NotesShortcutsHelp() {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  const show = useCallback(() => {
    const active = document.activeElement as HTMLElement | null;
    restoreFocusRef.current = active && active !== document.body ? active : btnRef.current;
    setOpen(true);
  }, []);
  const close = useCallback(() => {
    setOpen(false);
    const back = restoreFocusRef.current ?? btnRef.current;
    restoreFocusRef.current = null;
    // After the portal unmounts.
    requestAnimationFrame(() => back?.focus({ preventScroll: true }));
  }, []);

  // Hotkeys. Capture phase so we run before the app-wide "?" help and can
  // mark the event handled (it skips defaultPrevented events).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing || !isHelpHotkey(e)) return;
      // A plain "?" inside a block is just a character.
      if (e.key === '?' && isTypingTarget(e.target)) return;
      if (document.body.hasAttribute('data-space-modal-open') && !open) return; // another menu owns the keyboard
      e.preventDefault();
      if (open) close();
      else show();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, show, close]);

  // Tell the space overlay's Esc handler to leave this panel alone.
  useEffect(() => {
    if (!open) return;
    document.body.setAttribute('data-space-modal-open', '1');
    requestAnimationFrame(() => panelRef.current?.focus({ preventScroll: true }));
    return () => document.body.removeAttribute('data-space-modal-open');
  }, [open]);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={() => (open ? close() : show())}
        aria-label="Notes shortcuts and commands"
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Shortcuts & commands (?)"
        data-testid="notes-help-button"
        className="inline-flex items-center justify-center w-5 h-5 rounded-full text-gray-400 hover:text-brand-700 hover:bg-brand-50 outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
      >
        <HelpCircle className="w-4 h-4" />
      </button>
      <Popover open={open} onClose={close} anchorRef={btnRef} align="end">
        <div
          ref={panelRef}
          tabIndex={-1}
          aria-label="Notes shortcuts and commands"
          data-testid="notes-help-panel"
          className="w-[26rem] max-w-[calc(100vw-16px)] max-h-[min(70vh,560px)] overflow-y-auto outline-none"
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation();
              close();
            }
          }}
        >
          <div className="sticky top-0 z-10 flex items-center justify-between gap-2 bg-white border-b border-gray-100 px-4 py-2.5">
            <div className="text-sm font-semibold text-gray-900">Notes shortcuts</div>
            <button
              type="button"
              onClick={close}
              aria-label="Close shortcuts"
              className="p-1 rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100 outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="px-4 py-2">
            {SECTIONS.map((s) => (
              <section key={s.id} className="py-2" aria-labelledby={`notes-help-${s.id}`}>
                <h3 id={`notes-help-${s.id}`} className="text-[10px] uppercase tracking-widest font-bold text-gray-500 mb-1.5">
                  {s.title}
                </h3>
                {s.note && <p className="text-[11px] text-gray-400 -mt-1 mb-1.5">{s.note}</p>}
                <ul className="space-y-1">
                  {s.rows.map((r, i) => (
                    <li key={`${s.id}-${i}`} className="flex items-start justify-between gap-3 text-[13px] text-gray-700">
                      <span className="min-w-0">
                        <span className="block">{r.label}</span>
                        {r.hint && <span className="block text-[11px] text-gray-400">{r.hint}</span>}
                      </span>
                      <span className="flex shrink-0 items-center gap-1">
                        {r.keys.map((k, j) =>
                          k === 'or' ? (
                            <span key={j} className="text-[11px] text-gray-400">or</span>
                          ) : (
                            <kbd key={j} className="kbd whitespace-nowrap">{k}</kbd>
                          ),
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
            <p className="pt-2 pb-1 text-[11px] text-gray-400">Press <kbd className="kbd">?</kbd> outside Notes for app-wide shortcuts.</p>
          </div>
        </div>
      </Popover>
    </>
  );
}
