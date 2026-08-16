/**
 * Shared PWA install state (module-level singleton).
 * Lets the auto-prompt banner AND the permanent navbar install button
 * both use the captured `beforeinstallprompt` event.
 */
import { useEffect, useState } from 'react';

let deferredPrompt = null;
const listeners = new Set();

export function capturePrompt(e) {
  e.preventDefault();
  deferredPrompt = e;
  for (const fn of listeners) fn(e);
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getDeferred() {
  return deferredPrompt;
}

export function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || !!window.navigator.standalone;
}

/** Trigger the native install flow. Returns true if it was shown. */
export async function promptInstall() {
  if (!deferredPrompt) return false;
  deferredPrompt.prompt();
  await deferredPrompt.userChoice;
  deferredPrompt = null;
  return true;
}

/** React hook: true when the app is installable and not already installed. */
export function usePwaInstall() {
  const [deferred, setDeferred] = useState(deferredPrompt);
  useEffect(() => subscribe(setDeferred), []);
  return { canInstall: !!deferred && !isStandalone(), install: promptInstall };
}
