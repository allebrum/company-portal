/**
 * DOM helpers for the Notes canvas' per-block contentEditable elements.
 *
 * The canvas keeps every editable block's DOM as *plain text nodes only*
 * (rendered with `white-space: pre-wrap`). Soft line breaks (Shift+Enter)
 * are literal `\n` characters. Because a trailing `\n` doesn't render an
 * empty line in pre-wrap, a zero-width space sentinel is appended after it;
 * the sentinel is never part of the stored content.
 *
 * Everything here maps between "text offsets" (indices into the stored
 * string) and DOM positions, tolerating stray browser-inserted <br>/<div>
 * nodes so the state never desyncs from what the user sees.
 */

export const ZWSP = '\u200B';

const BLOCK_TAGS = new Set(['DIV', 'P', 'LI', 'UL', 'OL', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'PRE']);

/**
 * Read the logical text of an element or fragment. `<br>` → `\n` (except a
 * trailing placeholder `<br>` that browsers leave in otherwise-empty lines),
 * block elements start a new line, ZWSP sentinels and NBSPs are normalized.
 */
export function readText(root: Node, opts: { ignoreTrailingBr?: boolean } = {}): string {
  const ignoreTrailingBr = opts.ignoreTrailingBr ?? true;
  let out = '';
  const walk = (n: Node, isRoot: boolean) => {
    if (n.nodeType === 3 /* TEXT_NODE */) {
      out += n.nodeValue ?? '';
      return;
    }
    if (n.nodeType !== 1 /* ELEMENT_NODE */ && n.nodeType !== 11 /* DOCUMENT_FRAGMENT_NODE */) return;
    const name = n.nodeName;
    if (name === 'BR') {
      if (ignoreTrailingBr && n.parentNode && n.parentNode.lastChild === n) return;
      out += '\n';
      return;
    }
    const isBlock = !isRoot && n.nodeType === 1 && BLOCK_TAGS.has(name);
    if (isBlock && out.length > 0 && !out.endsWith('\n')) out += '\n';
    n.childNodes.forEach((c) => walk(c, false));
  };
  walk(root, true);
  return out.replace(/\u200B/g, '').replace(/\u00A0/g, ' ');
}

/** The DOM string we render for a given logical text. */
export function domTextFor(text: string): string {
  return text.endsWith('\n') ? `${text}${ZWSP}` : text;
}

/** Replace the element's contents with a single plain text node. */
export function writeText(el: HTMLElement, text: string): void {
  const dom = domTextFor(text);
  if (dom === '') {
    el.textContent = '';
    return;
  }
  el.textContent = dom;
}

/**
 * True when the DOM no longer matches the "plain text node(s) only"
 * invariant and should be rewritten from the logical text.
 */
export function needsNormalize(el: HTMLElement, text: string): boolean {
  for (const n of Array.from(el.childNodes)) {
    if (n.nodeType !== 3) return true;
  }
  if (text === '' && (el.textContent ?? '') !== '') return true;
  const dom = el.textContent ?? '';
  if (text.endsWith('\n') && !dom.endsWith(ZWSP)) return true;
  // A sentinel left over from an earlier trailing newline.
  if (!text.endsWith('\n') && dom.includes(ZWSP)) return true;
  return false;
}

/** Current selection as text offsets inside `el`, or null if it's elsewhere. */
export function getOffsets(el: HTMLElement): { start: number; end: number } | null {
  const sel = typeof window !== 'undefined' ? window.getSelection() : null;
  if (!sel || sel.rangeCount === 0) return null;
  const r = sel.getRangeAt(0);
  if (!el.contains(r.startContainer) || !el.contains(r.endContainer)) return null;
  const pre = document.createRange();
  pre.selectNodeContents(el);
  pre.setEnd(r.startContainer, r.startOffset);
  const start = readText(pre.cloneContents(), { ignoreTrailingBr: false }).length;
  if (r.collapsed) return { start, end: start };
  const upto = document.createRange();
  upto.selectNodeContents(el);
  upto.setEnd(r.endContainer, r.endOffset);
  const end = readText(upto.cloneContents(), { ignoreTrailingBr: false }).length;
  return { start, end };
}

/** Place a collapsed caret at a text offset (Infinity → end). */
export function setCaret(el: HTMLElement, offset: number): void {
  const sel = window.getSelection();
  if (!sel) return;
  const range = document.createRange();
  let remaining = Math.max(0, offset);
  let placed = false;
  if (Number.isFinite(remaining)) {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode() as Text | null;
    while (node && !placed) {
      const v = node.data;
      for (let i = 0; i <= v.length; i++) {
        if (remaining === 0) {
          range.setStart(node, i);
          placed = true;
          break;
        }
        if (i < v.length && v[i] !== ZWSP) remaining--;
      }
      node = walker.nextNode() as Text | null;
    }
  }
  if (!placed) {
    range.selectNodeContents(el);
    range.collapse(false);
  } else {
    range.collapse(true);
  }
  sel.removeAllRanges();
  sel.addRange(range);
}

function px(v: string, fallback: number): number {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
}

export function lineHeightOf(el: HTMLElement): number {
  const cs = getComputedStyle(el);
  const lh = px(cs.lineHeight, NaN);
  if (Number.isFinite(lh)) return lh;
  return px(cs.fontSize, 16) * 1.4;
}

export type CaretBox = { x: number; top: number; bottom: number };

/**
 * Screen box of the caret inside `el`. Never returns null: falls back to a
 * measured zero-width marker, then to the element's own content box, so the
 * slash menu always has an anchor.
 */
export function caretBox(el: HTMLElement): CaretBox {
  const sel = window.getSelection();
  if (sel && sel.rangeCount > 0) {
    const live = sel.getRangeAt(0);
    if (el.contains(live.startContainer)) {
      const r = live.cloneRange();
      r.collapse(false);
      const rects = r.getClientRects();
      const last = rects[rects.length - 1];
      if (last && (last.height > 0 || last.width > 0)) {
        return { x: last.left, top: last.top, bottom: last.bottom };
      }
      // Collapsed ranges at a line start / in empty text often report no
      // rects. Measure with a temporary marker, then restore the caret.
      const offsets = getOffsets(el);
      try {
        const marker = document.createElement('span');
        marker.textContent = ZWSP;
        r.insertNode(marker);
        const mr = marker.getBoundingClientRect();
        const parent = marker.parentNode;
        marker.remove();
        parent?.normalize();
        if (offsets) setCaret(el, offsets.start);
        if (mr.height > 0) return { x: mr.left, top: mr.top, bottom: mr.bottom };
      } catch {
        if (offsets) setCaret(el, offsets.start);
      }
    }
  }
  const box = el.getBoundingClientRect();
  const cs = getComputedStyle(el);
  const top = box.top + px(cs.paddingTop, 0);
  return { x: box.left + px(cs.paddingLeft, 0), top, bottom: top + lineHeightOf(el) };
}

/** Is the caret on the first visual line of `el`? */
export function caretOnFirstLine(el: HTMLElement): boolean {
  const c = caretBox(el);
  const box = el.getBoundingClientRect();
  const top = box.top + px(getComputedStyle(el).paddingTop, 0);
  return c.top - top < lineHeightOf(el) * 0.8;
}

/** Is the caret on the last visual line of `el`? */
export function caretOnLastLine(el: HTMLElement): boolean {
  const c = caretBox(el);
  const box = el.getBoundingClientRect();
  const bottom = box.bottom - px(getComputedStyle(el).paddingBottom, 0);
  return bottom - c.bottom < lineHeightOf(el) * 0.8;
}

/**
 * Focus `el` and put the caret on its first/last visual line as close to
 * screen x-coordinate `x` as possible (vertical arrow-key navigation).
 */
export function placeCaretNearX(el: HTMLElement, x: number, line: 'first' | 'last'): void {
  el.focus({ preventScroll: false });
  const box = el.getBoundingClientRect();
  const cs = getComputedStyle(el);
  const lh = lineHeightOf(el);
  const y = line === 'first'
    ? box.top + px(cs.paddingTop, 0) + lh / 2
    : box.bottom - px(cs.paddingBottom, 0) - lh / 2;
  const cx = Math.min(Math.max(x, box.left + 1), box.right - 1);
  let range: Range | null = null;
  const d = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
  };
  if (typeof d.caretPositionFromPoint === 'function') {
    const p = d.caretPositionFromPoint(cx, y);
    if (p) {
      range = document.createRange();
      range.setStart(p.offsetNode, p.offset);
    }
  } else if (typeof document.caretRangeFromPoint === 'function') {
    range = document.caretRangeFromPoint(cx, y);
  }
  const sel = window.getSelection();
  if (range && sel && el.contains(range.startContainer)) {
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
    return;
  }
  setCaret(el, line === 'first' ? 0 : Infinity);
}
