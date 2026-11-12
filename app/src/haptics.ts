// A light tap you can feel, where the device allows it. Android has the
// Vibration API. iOS Safari has none, but toggling a native switch control
// (iOS 17.4+) plays the system's selection haptic, so a hidden one is flipped.
// Anywhere else this quietly does nothing.

let lever: HTMLLabelElement | null = null;

function iosLever(): HTMLLabelElement | null {
  if (lever) return lever;
  if (typeof document === 'undefined') return null;
  const label = document.createElement('label');
  label.setAttribute('aria-hidden', 'true');
  label.style.cssText = 'position:fixed;left:-100px;top:-100px;width:1px;height:1px;opacity:0;pointer-events:none;';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.setAttribute('switch', '');
  input.tabIndex = -1;
  label.appendChild(input);
  document.body.appendChild(label);
  lever = label;
  return lever;
}

export function haptic(kind: 'tap' | 'success' = 'tap'): void {
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate(kind === 'success' ? [12, 40, 18] : 8);
      return;
    }
    const l = iosLever();
    if (!l) return;
    l.click();
    if (kind === 'success') window.setTimeout(() => l.click(), 90);
  } catch {
    /* a missing haptic must never break anything */
  }
}
