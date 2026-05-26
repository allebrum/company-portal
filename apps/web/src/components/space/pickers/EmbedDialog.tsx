'use client';

import { useEffect, useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Field, Input } from '@/components/ui/Field';

export type EmbedDialogValue = { url: string; title: string };

/**
 * Tiny URL + optional title modal. Used in two slightly different intents:
 *  - `embed` — invoked by the `/embed` slash command in Notes. The result
 *    becomes an embed block + also gets registered in the Files tab with a
 *    "from Notes" badge.
 *  - `file`  — invoked from the Files tab's "Paste link" affordance. Same
 *    inputs, slightly different button copy.
 *
 * Sets `data-space-modal-open` on the body so the overlay's ESC handler
 * yields to this modal's ESC (the Modal primitive already handles ESC
 * locally; the attribute is a hint for nested layers).
 */
export function EmbedDialog({
  open,
  onClose,
  onSubmit,
  intent = 'embed',
  initialUrl = '',
  initialTitle = '',
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (v: EmbedDialogValue) => void;
  intent?: 'embed' | 'file';
  initialUrl?: string;
  initialTitle?: string;
}) {
  const [url, setUrl] = useState(initialUrl);
  const [title, setTitle] = useState(initialTitle);

  useEffect(() => {
    if (open) {
      setUrl(initialUrl);
      setTitle(initialTitle);
      document.body.setAttribute('data-space-modal-open', '1');
    } else {
      document.body.removeAttribute('data-space-modal-open');
    }
    return () => document.body.removeAttribute('data-space-modal-open');
  }, [open, initialUrl, initialTitle]);

  const submit = () => {
    if (!url.trim()) return;
    onSubmit({ url: url.trim(), title: title.trim() });
  };

  const cta = intent === 'file' ? 'Attach link' : 'Insert embed';
  const headline = intent === 'file' ? 'Attach a URL' : 'Embed a link';

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={headline}
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={submit} disabled={!url.trim()}>{cta}</Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="URL">
          <Input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
            placeholder="https://figma.com/file/…"
            autoFocus
          />
        </Field>
        <Field label="Display title" hint="Optional — defaults to the URL.">
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
            placeholder="Q4 launch mocks"
          />
        </Field>
        <p className="text-[11px] text-gray-500">
          {intent === 'embed'
            ? 'The link will render as an embed card in this Notes canvas and also appear in the Files tab.'
            : 'External links live in this space\'s Files tab. They open in a new tab when clicked.'}
        </p>
      </div>
    </Modal>
  );
}
