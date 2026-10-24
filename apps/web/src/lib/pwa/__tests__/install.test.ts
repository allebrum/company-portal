import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeInstallState, isIos, isIosSafari } from '../install';
import { swEnabled } from '../serviceWorker';

const IPHONE_SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const IPHONE_CHROME = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0 Mobile/15E148 Safari/604.1';
const IPAD_DESKTOP_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
const MAC_CHROME = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

test('iOS detection, including iPadOS posing as a Mac', () => {
  assert.equal(isIos(IPHONE_SAFARI, 5), true);
  assert.equal(isIos(IPAD_DESKTOP_UA, 5), true);
  assert.equal(isIos(IPAD_DESKTOP_UA, 0), false); // real Mac Safari
  assert.equal(isIosSafari(IPHONE_CHROME, 5), false);
  assert.equal(isIosSafari(IPHONE_SAFARI, 5), true);
});

test('install state: hidden when installed, prompt on Chromium, hint on iOS Safari', () => {
  const base = { standalone: false, installedFlag: false, hasPrompt: false, ua: MAC_CHROME, maxTouchPoints: 0 };
  assert.deepEqual(computeInstallState(base), { canPrompt: false, installed: false, iosHint: false });
  assert.deepEqual(computeInstallState({ ...base, hasPrompt: true }), { canPrompt: true, installed: false, iosHint: false });
  assert.deepEqual(computeInstallState({ ...base, hasPrompt: true, standalone: true }), { canPrompt: false, installed: true, iosHint: false });
  assert.deepEqual(computeInstallState({ ...base, installedFlag: true }), { canPrompt: false, installed: true, iosHint: false });
  assert.deepEqual(computeInstallState({ ...base, ua: IPHONE_SAFARI, maxTouchPoints: 5 }), { canPrompt: false, installed: false, iosHint: true });
  assert.equal(computeInstallState({ ...base, ua: IPHONE_SAFARI, maxTouchPoints: 5, standalone: true }).iosHint, false);
});

test('the service worker only runs in secure production builds and honours the kill switch', () => {
  const ok = { nodeEnv: 'production', hasSw: true, secure: true };
  assert.equal(swEnabled(ok), true);
  assert.equal(swEnabled({ ...ok, nodeEnv: 'development' }), false);
  assert.equal(swEnabled({ ...ok, disabled: '1' }), false);
  assert.equal(swEnabled({ ...ok, secure: false }), false);
  assert.equal(swEnabled({ ...ok, hasSw: false }), false);
});
