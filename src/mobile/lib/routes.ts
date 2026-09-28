import { MOBILE_ROOT } from "@/lib/mobile-route";

/**
 * Every /m URL is built here. When the phone UI is extracted into its own app,
 * this file and MOBILE_ROOT are the only things that change.
 *
 * Note the addressing split, which mirrors the API's own: screens that *add*
 * items are (tableId, subtable)-addressed because the order may not exist yet
 * (sendToKitchen creates it), while screens that *view or settle* a bill are
 * orderId-addressed.
 */
export const mRoutes = {
  tables: () => `${MOBILE_ROOT}/tables`,
  table: (tableId: string) => `${MOBILE_ROOT}/t/${tableId}`,
  // subtable is nullable and its labels are free text ("Gino"), so it travels
  // as a query param rather than a path segment needing a null sentinel
  order: (tableId: string, subtable?: string | null) =>
    `${MOBILE_ROOT}/t/${tableId}/order` +
    (subtable ? `?s=${encodeURIComponent(subtable)}` : ""),
  bills: () => `${MOBILE_ROOT}/bills`,
  bill: (orderId: string) => `${MOBILE_ROOT}/o/${orderId}`,
  pay: (orderId: string) => `${MOBILE_ROOT}/o/${orderId}/pay`,
  move: (orderId: string) => `${MOBILE_ROOT}/o/${orderId}/move`,
  takeaway: () => `${MOBILE_ROOT}/takeaway`,
  // take-away order taking is addressed by the order, which always exists by
  // then: a take-away is created the moment it is named
  takeawayOrder: (orderId: string) => `${MOBILE_ROOT}/ta/${orderId}/order`,
  chat: () => `${MOBILE_ROOT}/chat`,
  thread: (conversationId: string) => `${MOBILE_ROOT}/chat/${conversationId}`,
};
