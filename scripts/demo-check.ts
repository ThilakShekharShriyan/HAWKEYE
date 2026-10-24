// End-to-end check of the demo flow against a running dev server, using your
// own photos. It writes to the real database, so use a throwaway site name.
//
//   node scripts/demo-check.ts <before.jpg> <after.jpg> [site=table] [item="coke can"] [base=http://localhost:3000]
//
// Photos must be under 1.5 MB each (the episode upload limit); downscale phone
// photos first. Set HAWKEYE_ACCESS_TOKEN if the server has one. Close any open
// dashboard tab first: this script needs the capture lease.
//
// 1. Observer 01 says "remember this <site>" while looking at <before.jpg>.
// 2. Observer 02's watcher sends an episode whose last frame is <after.jpg>.
// 3. Observer 01, looking at nothing, asks how many <item> are left.
import { readFileSync } from "node:fs";

const [before, after, site = "table", item = "coke can", base = "http://localhost:3000"] = process.argv.slice(2);
if (!before || !after) {
  console.error('usage: node scripts/demo-check.ts <before.jpg> <after.jpg> [site] [item] [base]');
  process.exit(1);
}
const MAX_PHOTO_BYTES = 1_500_000;
const token = process.env.HAWKEYE_ACCESS_TOKEN?.trim();
const image = (path: string) => {
  const bytes = readFileSync(path);
  if (bytes.length > MAX_PHOTO_BYTES) {
    console.error(`${path} is ${bytes.length} bytes; the limit is ${MAX_PHOTO_BYTES}. Downscale it first.`);
    process.exit(1);
  }
  return bytes.toString("base64");
};

async function post(path: string, body: unknown) {
  const started = performance.now();
  const response = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { "x-hawkeye-token": token } : {}) },
    body: JSON.stringify(body),
  });
  const json = (await response.json()) as Record<string, unknown>;
  return { status: response.status, ms: Math.round(performance.now() - started), json };
}

const register = await post("/api/ask", {
  observerId: "01",
  text: `Hey World, remember this ${site}`,
  image: image(before),
});
console.log(`1. register  ${register.status} ${register.ms}ms  anchor=${register.json.anchor}  "${register.json.answer}"`);

const viewer = "demo-check";
const lease = await post("/api/capture/lease", { viewer });
if (lease.json.leader !== true) {
  console.error(`could not take the capture lease (status ${lease.status}); close any open dashboard and retry`);
  process.exit(1);
}
// The lease lasts 8 seconds and a model call can take longer, so keep renewing.
const renew = setInterval(() => void post("/api/capture/lease", { viewer }).catch(() => {}), 3000);
const now = Date.now();
let episode: Awaited<ReturnType<typeof post>>;
try {
  episode = await post("/api/episodes", {
    observerId: "02",
    viewer,
    trigger: `${site} · demo-check`,
    site,
    frames: [
      { image: image(before), at: now - 4000, phase: "pre" },
      { image: image(after), at: now, phase: "after" },
    ],
    stats: { durationMs: 4000, framesCaptured: 2, framesDiscarded: 0, detections: 2 },
  });
} finally {
  clearInterval(renew);
}
if (episode.status !== 200 || episode.json.skipped) {
  console.error(`episode failed: status ${episode.status}, skipped=${String(episode.json.skipped ?? "no")}`);
  process.exit(1);
}
console.log(
  `2. episode   ${episode.status} ${episode.ms}ms  site=${episode.json.container} identity=${episode.json.identity ?? episode.json.skipped}  changes=${JSON.stringify(episode.json.changes)}`,
);
console.log(`   inventory ${JSON.stringify(episode.json.inventory)}`);

const question = await post("/api/ask", {
  observerId: "01",
  text: `Hey World, how many ${item}s are left ${site === "fridge" ? "in" : "on"} the ${site}?`,
});
console.log(`3. question  ${question.status} ${question.ms}ms  "${question.json.answer}"`);
