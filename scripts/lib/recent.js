/**
 * Recent shows: the last few shows a venue held. The scraper only keeps upcoming events, so each run
 * moves the shows that have passed since the last run into data/recent-shows.json before they're dropped.
 * A show counts once its day is over and it was still on the schedule the day it happened, so shows a
 * venue cancelled in advance never appear.
 */

export const KEEP = 3;

/** Shows from `events` (the last stored schedule) that started before `today` (an ISO date), merged into `recent`. */
export function recordPast(recent = [], events = [], today, keep = KEEP) {
  const byId = new Map(recent.map((e) => [e.id, e]));
  for (const e of events) {
    if (e.start.slice(0, 10) >= today) continue;
    const { id, title, start, allDay } = e;
    byId.set(id, allDay ? { id, title, start, allDay } : { id, title, start });
  }
  return [...byId.values()].sort((a, b) => b.start.localeCompare(a.start) || a.title.localeCompare(b.title)).slice(0, keep);
}
