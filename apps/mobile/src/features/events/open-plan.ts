import type { ImperativeRouter } from 'expo-router';
import { type BrowseContext, useBrowseStore } from '../../stores/browse-store';

/** A plan in the row it was opened from: its id, or anything carrying one (feed items, summaries, pins). */
export type PlanSibling = string | { id: string };

export interface OpenPlanOptions {
  /** Ranked-feed rows: the request id and each plan's feed position, for click logging while swiping. */
  feed?: { requestId: string; positionOf: (id: string) => number | null } | null;
}

/** The row's plan ids in order, each once; the tapped plan is always in it. */
export function siblingIds(id: string, siblings: readonly PlanSibling[]): string[] {
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const s of siblings) {
    const sid = typeof s === 'string' ? s : s.id;
    if (!seen.has(sid)) {
      seen.add(sid);
      ids.push(sid);
    }
  }
  return seen.has(id) ? ids : [];
}

/**
 * Opens a plan from a list (D-219). With the row's other plans the plan screen becomes a swipeable deck that
 * starts at this one; a lone plan (or no row) opens on its own, as a deep link would.
 */
export function openPlan(
  router: Pick<ImperativeRouter, 'push'>,
  id: string,
  siblings: readonly PlanSibling[] = [],
  options: OpenPlanOptions = {},
): void {
  const ids = siblingIds(id, siblings);
  if (ids.length < 2) {
    router.push({ pathname: '/events/[id]', params: { id } });
    return;
  }
  const context: BrowseContext = {
    ids,
    index: ids.indexOf(id),
    feed: options.feed
      ? {
          requestId: options.feed.requestId,
          positions: ids.map((sid) => options.feed?.positionOf(sid) ?? null),
        }
      : null,
  };
  const browse = useBrowseStore.getState().open(context);
  router.push({ pathname: '/events/[id]', params: { id, browse } });
}
