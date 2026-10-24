import { eventPaths, formatClock, searchEvents } from "@/lib/events-repo";

// Things that were seen or that people asked to be remembered. Questions and
// earlier answers are deliberately left out: fed back as "memories", one
// stale or wrong answer gets repeated as fact from then on.

type Recalled = {
  when: string;
  type: string;
  observerId?: string;
  text: string;
  path?: string;
};

export async function retrieveMemories(query: string, limit = 6) {
  const { mode, events } = await searchEvents(query, limit);
  const paths = await eventPaths(events.map((event) => event.id)).catch(() => new Map<string, string>());
  const memories: Recalled[] = events.map((doc) => {
    const path = paths.get(doc.id);
    return {
      when: `${doc.ts.toISOString().slice(0, 10)} ${formatClock(doc.ts)}`,
      type: doc.type,
      observerId: doc.observerId,
      text: path ? `${doc.summary} [path: ${path}]` : doc.summary,
      path,
    };
  });
  return { mode, memories };
}
