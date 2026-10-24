// Resets the graph to the seeded house before a demo (see lib/demo-reset.ts).
//   npm run demo:reset           shows what would be removed, changes nothing
//   npm run demo:reset -- --yes  removes it, then run npm run seed:demo
import { applyReset, planReset } from "../lib/demo-reset.ts";

const plan = await planReset();
console.log(`camera-made places: ${plan.places.length ? plan.places.join(", ") : "none"}`);
console.log(`seeded sites with camera photos to clear: ${plan.seededWithPhotos.length ? plan.seededWithPhotos.join(", ") : "none"}`);
console.log(`active privacy windows to clear: ${plan.activePrivacy}`);
console.log(`events (seeded samples kept): ${plan.events}`);
console.log(`memory and caches: ${Object.entries(plan.memory).map(([label, n]) => `${label} ${n}`).join(", ")}`);
if (!process.argv.includes("--yes")) {
  console.log("\nDry run: nothing changed. Run with -- --yes to remove the above.");
  process.exit(0);
}
await applyReset(plan);
console.log("\nReset done. Now run: npm run seed:demo");
process.exit(0);
