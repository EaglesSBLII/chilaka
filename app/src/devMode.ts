// Tester mode for the owner's DEVELOPER VERSION only (the build behind the
// dashboard password). It never applies to the released app: __CHANNEL__ is
// 'release' there and all of this compiles away.
//
// In the developer version: every unit and lesson is open, the coin balance is
// topped up so the whole shop can be tried, accounts are practice accounts
// kept on this device (devAccounts.ts), and Settings has "Start over as a new
// user". Real progress still shows (done lessons, the current lesson).

export const DEV_TEST = typeof __CHANNEL__ !== 'undefined' && __CHANNEL__ === 'dev';

/** Coins the tester always has at least this many of. */
export const DEV_COINS = 50_000;

/** A locked unit shows as open in the developer version. */
export function devOpen<T extends string>(status: T): T | 'active' {
  return DEV_TEST && status === 'locked' ? 'active' : status;
}

/** What a lesson that would be locked shows as. */
export const LOCKED_NODE = DEV_TEST ? ('replayable' as const) : ('locked' as const);
