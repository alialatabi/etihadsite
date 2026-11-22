/**
 * The popup of the success page («راح نتأكد من كل تصميم …») shows once per order on arrival. The customer closing it is
 * remembered in this tab's sessionStorage, keyed by the order number, so a reload of the page does not show it again.
 * Everything is best effort: with no storage the popup simply shows on every arrival.
 */
export const ORDER_NOTE_KEY_PREFIX = 'ub:order-note:v1:';

type Store = Pick<Storage, 'getItem' | 'setItem'>;

function defaultStore(): Store | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
}

export const orderNoteKey = (displayNo: string): string => `${ORDER_NOTE_KEY_PREFIX}${displayNo}`;

/** True while the customer has not yet closed the popup of this order. */
export function shouldShowOrderNote(displayNo: string, store: Store | null = defaultStore()): boolean {
  try {
    return store ? store.getItem(orderNoteKey(displayNo)) === null : true;
  } catch {
    return true;
  }
}

/** The customer closed the popup of this order. */
export function markOrderNoteSeen(displayNo: string, store: Store | null = defaultStore()): void {
  try {
    store?.setItem(orderNoteKey(displayNo), '1');
  } catch {
    /* ignore */
  }
}
