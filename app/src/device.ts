// What kind of device is this? Used to offer alternatives where an exercise
// needs a touch screen (drawing letters with a finger).

/** A computer (mouse or trackpad is the main pointer): the Mac app, or a laptop / desktop browser. */
export function isComputer(): boolean {
  if (typeof window === 'undefined') return false;
  if (window.chilakaBridge) return true;
  const mq = (q: string) => window.matchMedia?.(q).matches ?? false;
  // a mouse or trackpad that can hover: a laptop or desktop, touch screen or not
  if (mq('(any-pointer: fine)') && mq('(any-hover: hover)') && !mq('(pointer: coarse)')) return true;
  const touch = (navigator.maxTouchPoints ?? 0) > 0;
  return !touch && !mq('(any-pointer: coarse)');
}
