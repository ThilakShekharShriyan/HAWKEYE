import { eventsSince } from "@/lib/events-repo";
import { listContainers } from "@/lib/perception";
import { computeTrends, parseChange, type Change, type Stock } from "@/lib/trends";

/** Usage trends for every tracked item, from stored changes and current contents. */
export async function loadTrends(windowDays = 14, now = new Date()) {
  const since = new Date(now.getTime() - windowDays * 86_400_000);
  const [events, sites] = await Promise.all([
    eventsSince("transition", since, 2000),
    listContainers(),
  ]);
  const changes = events.map((event) => parseChange(event)).filter((c): c is Change => c !== null);
  const stock: Stock[] = sites.flatMap((site) =>
    site.items.map((item) => ({ site: site.name, name: item.name, count: item.count, since: item.since })),
  );
  return computeTrends(changes, stock, now, windowDays);
}
