/**
 * "Install app" state: the Chromium `beforeinstallprompt` event, whether we're
 * already running installed (standalone), and whether this is iOS Safari
 * (which has no prompt — users go Share → Add to Home Screen).
 *
 * `beforeinstallprompt` can fire before React hydrates, so the root layout
 * has a tiny inline script that stashes it on `window.__hoppaInstallPrompt`;
 * `initInstallState` picks it up from there.
 */

export type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform?: string }>;
};

declare global {
  interface Window {
    __hoppaInstallPrompt?: BeforeInstallPromptEvent | null;
    __hoppaInstalled?: boolean;
  }
}

export type InstallState = {
  /** Chromium prompt is available — show the Install button. */
  canPrompt: boolean;
  /** Running as an installed app (or just installed). Hide everything. */
  installed: boolean;
  /** iOS/iPadOS Safari, not installed — show the Add to Home Screen hint. */
  iosHint: boolean;
};

export function isIos(ua: string, maxTouchPoints: number): boolean {
  if (/iPad|iPhone|iPod/.test(ua)) return true;
  // iPadOS 13+ reports itself as a Mac; touch support gives it away.
  return /Macintosh/.test(ua) && maxTouchPoints > 1;
}

/** Safari proper — Chrome/Firefox/Edge on iOS can't add to the home screen the same way (older iOS) and say CriOS/FxiOS/EdgiOS. */
export function isIosSafari(ua: string, maxTouchPoints: number): boolean {
  return isIos(ua, maxTouchPoints) && /Safari\//.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua);
}

export function computeInstallState(env: {
  standalone: boolean;
  installedFlag: boolean;
  hasPrompt: boolean;
  ua: string;
  maxTouchPoints: number;
}): InstallState {
  const installed = env.standalone || env.installedFlag;
  if (installed) return { canPrompt: false, installed: true, iosHint: false };
  return {
    canPrompt: env.hasPrompt,
    installed: false,
    iosHint: !env.hasPrompt && isIosSafari(env.ua, env.maxTouchPoints),
  };
}

type Listener = () => void;
const listeners = new Set<Listener>();
let snapshot: InstallState = { canPrompt: false, installed: false, iosHint: false };
let inited = false;

function isStandalone(): boolean {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    window.matchMedia?.('(display-mode: window-controls-overlay)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function recompute() {
  snapshot = computeInstallState({
    standalone: isStandalone(),
    installedFlag: !!window.__hoppaInstalled,
    hasPrompt: !!window.__hoppaInstallPrompt,
    ua: navigator.userAgent,
    maxTouchPoints: navigator.maxTouchPoints ?? 0,
  });
  listeners.forEach((l) => l());
}

export function initInstallState(): void {
  if (inited || typeof window === 'undefined') return;
  inited = true;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); // we show our own unobtrusive button instead of the mini-infobar
    window.__hoppaInstallPrompt = e as BeforeInstallPromptEvent;
    recompute();
  });
  window.addEventListener('appinstalled', () => {
    window.__hoppaInstalled = true;
    window.__hoppaInstallPrompt = null;
    recompute();
  });
  window.matchMedia?.('(display-mode: standalone)').addEventListener?.('change', recompute);
  recompute();
}

export function getInstallState(): InstallState {
  return snapshot;
}
export function getServerInstallState(): InstallState {
  return { canPrompt: false, installed: false, iosHint: false };
}
export function subscribeInstall(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** Show the browser's install dialog. Resolves to the user's choice. */
export async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  const e = window.__hoppaInstallPrompt;
  if (!e) return 'unavailable';
  // A prompt event is single-use.
  window.__hoppaInstallPrompt = null;
  await e.prompt();
  const choice = await e.userChoice;
  if (choice.outcome === 'accepted') window.__hoppaInstalled = true;
  recompute();
  return choice.outcome;
}

/** Inline script for <head>: catch the event even if it fires before hydration. */
export const EARLY_INSTALL_SCRIPT =
  "window.addEventListener('beforeinstallprompt',function(e){e.preventDefault();window.__hoppaInstallPrompt=e;});" +
  "window.addEventListener('appinstalled',function(){window.__hoppaInstalled=true;window.__hoppaInstallPrompt=null;});";
