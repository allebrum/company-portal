/**
 * Service-worker registration + the "new version available" state.
 *
 * The worker (public build output `/sw.js`, source `apps/web/sw/sw.js`) gets a
 * new version on every build, so after each deploy the browser installs it in
 * the background and leaves it WAITING. We surface that as a Reload prompt
 * (components/pwa/PwaUpdateToast.tsx) rather than swapping code underneath an
 * open page; clicking Reload tells the waiting worker to take over and then
 * reloads once it controls the page.
 *
 * Kill switch: build with NEXT_PUBLIC_DISABLE_SW=1 and every client that loads
 * the page unregisters its worker and drops the Hoppa caches.
 */

type Listener = () => void;

export type SwState = {
  /** A newer build is installed and waiting (or already took over in another tab). */
  updateReady: boolean;
};

let state: SwState = { updateReady: false };
const listeners = new Set<Listener>();
let registration: ServiceWorkerRegistration | null = null;
let started = false;
let reloading = false;

function set(next: Partial<SwState>) {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
}

export function getSwState(): SwState {
  return state;
}

export function subscribeSw(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** Minimum gap between focus/visibility-triggered update checks. */
export const MIN_CHECK_GAP_MS = 60 * 1000;
export const UPDATE_CHECK_INTERVAL_MS = 30 * 60 * 1000;

/** Whether this environment should run the worker at all. */
export function swEnabled(env: {
  nodeEnv?: string;
  disabled?: string;
  hasSw: boolean;
  secure: boolean;
}): boolean {
  if (env.nodeEnv !== 'production') return false; // dev server: no SW (HMR, no stale chunks)
  if (env.disabled === '1' || env.disabled === 'true') return false;
  return env.hasSw && env.secure;
}

async function killSwitch(): Promise<void> {
  const regs = await navigator.serviceWorker.getRegistrations();
  await Promise.all(regs.map((r) => r.unregister()));
  if ('caches' in window) {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('hoppa-')).map((k) => caches.delete(k)));
  }
}

function watch(reg: ServiceWorkerRegistration) {
  // Only an UPDATE is interesting: on first install there's no controller yet,
  // nothing stale is on screen, and the worker activates by itself.
  const markIfWaiting = () => {
    if (reg.waiting && navigator.serviceWorker.controller) set({ updateReady: true });
  };
  markIfWaiting();
  reg.addEventListener('updatefound', () => {
    const w = reg.installing;
    if (!w) return;
    w.addEventListener('statechange', () => {
      if (w.state === 'installed') markIfWaiting();
    });
  });
}

export function startServiceWorker(): void {
  if (started || typeof window === 'undefined') return;
  started = true;
  const hasSw = 'serviceWorker' in navigator;
  if (hasSw && (process.env.NEXT_PUBLIC_DISABLE_SW === '1' || process.env.NEXT_PUBLIC_DISABLE_SW === 'true')) {
    void killSwitch();
    return;
  }
  if (!swEnabled({ nodeEnv: process.env.NODE_ENV, disabled: process.env.NEXT_PUBLIC_DISABLE_SW, hasSw, secure: window.isSecureContext })) return;

  let hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // First install claiming the page: not an update, nothing to do.
    if (!hadController) {
      hadController = true;
      return;
    }
    if (reloading) {
      window.location.reload();
      return;
    }
    // Another tab clicked Reload and the new worker took over this one too.
    // This page still runs the old bundle, so keep offering the reload.
    set({ updateReady: true });
  });

  const register = () => {
    navigator.serviceWorker
      .register('/sw.js', { scope: '/', updateViaCache: 'none' })
      .then((reg) => {
        registration = reg;
        watch(reg);
        // Deploys land on every merge: look for a new build when the app comes
        // back to the foreground, and periodically while it stays open.
        // (An installed desktop window that just regains focus never changes
        // visibility, hence `focus` too.) Throttled: it's a tiny no-cache GET.
        let lastCheck = Date.now();
        const check = (force = false) => {
          if (document.visibilityState !== 'visible' || !navigator.onLine) return;
          if (!force && Date.now() - lastCheck < MIN_CHECK_GAP_MS) return;
          lastCheck = Date.now();
          void reg.update().catch(() => {});
        };
        document.addEventListener('visibilitychange', () => check());
        window.addEventListener('focus', () => check());
        window.addEventListener('online', () => check(true));
        window.setInterval(() => check(true), UPDATE_CHECK_INTERVAL_MS);
      })
      .catch(() => {
        /* registration failure is non-fatal: the app works without a SW */
      });
  };
  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register, { once: true });
}

/** User clicked Reload: activate the waiting worker, then reload once it controls the page. */
export function applyUpdate(): void {
  reloading = true;
  const waiting = registration?.waiting;
  if (waiting) {
    waiting.postMessage({ type: 'SKIP_WAITING' });
    // Safety net in case controllerchange never fires (e.g. worker errored).
    window.setTimeout(() => window.location.reload(), 3000);
  } else {
    window.location.reload();
  }
}

/** Test-only reset. */
export function __resetSwForTests(): void {
  state = { updateReady: false };
  started = false;
  reloading = false;
  registration = null;
  listeners.clear();
}
