import { create } from 'zustand';

/**
 * Where a plan was opened from (D-219): the ordered plans of the row it sat in, so the plan screen can swipe
 * to the next and previous ones. Kept here rather than in the URL (rows can hold a hundred plans); the route
 * only carries the short `browse` key. Without a key (deep link, notification, share link) the plan screen
 * shows the single plan, as before.
 */
export interface BrowseContext {
  /** The row's plans, in order, without duplicates. */
  ids: readonly string[];
  /** Index of the plan that was tapped. */
  index: number;
  /** For rows from the ranked feed: its request and each plan's position, so swipes log feed clicks too. */
  feed?: { requestId: string; positions: readonly (number | null)[] } | null;
}

/** Plan screens can stack (a plan, its crew, another plan); older contexts are dropped past this many. */
export const MAX_BROWSE_CONTEXTS = 8;

interface BrowseState {
  contexts: Record<string, BrowseContext>;
  /** Keys oldest first, for trimming. */
  order: string[];
  seq: number;
  /** Stores a row and returns the key the plan screen reads it back with. */
  open: (context: BrowseContext) => string;
  reset: () => void;
}

export const useBrowseStore = create<BrowseState>((set, get) => ({
  contexts: {},
  order: [],
  seq: 0,
  open: (context) => {
    const { contexts, order, seq } = get();
    const key = `b${String(seq + 1)}`;
    const nextOrder = [...order, key];
    const dropped = nextOrder.splice(0, Math.max(0, nextOrder.length - MAX_BROWSE_CONTEXTS));
    const nextContexts = Object.fromEntries(
      Object.entries({ ...contexts, [key]: context }).filter(([k]) => !dropped.includes(k)),
    );
    set({ contexts: nextContexts, order: nextOrder, seq: seq + 1 });
    return key;
  },
  reset: () => {
    set({ contexts: {}, order: [], seq: 0 });
  },
}));

/** The context a plan screen was opened with, if it still exists and holds that plan with company. */
export function browseContextFor(
  key: string | undefined,
  id: string | undefined,
): BrowseContext | null {
  if (!key || !id) return null;
  const context = useBrowseStore.getState().contexts[key];
  if (!context || context.ids.length < 2 || !context.ids.includes(id)) return null;
  return context;
}
