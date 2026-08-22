/**
 * Root of the phone-only waiter app. Kept in one place so the shell, the
 * device redirect and the mobile route builders can never disagree — and so
 * extracting /m into its own Next app is a one-constant change.
 */
export const MOBILE_ROOT = "/m";

/**
 * Exact-segment test. Deliberately not `startsWith("/m")`, which would also
 * swallow a future `/menu` or `/mystats`.
 */
export function isMobileRoute(pathname: string): boolean {
  return pathname === MOBILE_ROOT || pathname.startsWith(`${MOBILE_ROOT}/`);
}

/**
 * Chat lives at a different URL in each UI. App-wide code (the incoming-message
 * toast) needs to send the user to the one they are actually in: pushing the
 * desktop /chat from the phone UI gets bounced straight back to /m by the
 * device redirect, losing the message the user just tapped.
 *
 * Lives here rather than in mobile/lib/routes so non-mobile code can use it —
 * the dependency on src/mobile has to stay one-way.
 */
export function chatRouteFor(pathname: string): string {
  return isMobileRoute(pathname) ? `${MOBILE_ROOT}/chat` : "/chat";
}
