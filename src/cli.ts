import { connect } from "./db";
import { seed } from "./seed";
import { whoToMeet, recommendTalks, planTalk, recordMeeting, recall } from "./queries";

const [cmd, ...args] = process.argv.slice(2);
const me = process.env.HAWKEYE_USER ?? "me";
const { db, graph } = await connect();

try {
  switch (cmd) {
    case "seed":
      await seed(graph);
      console.log("seeded");
      break;
    case "meet":
      for (const p of await whoToMeet(graph, me)) console.log(`- ${p.name} · ${p.role} @ ${p.company}\n    ${p.why}`);
      break;
    case "talks":
      for (const t of await recommendTalks(graph, me)) console.log(`- [${t.slot}] ${t.title}\n    ${t.why}`);
      break;
    case "plan":
      await planTalk(graph, me, args[0], args[1] ?? "planner-agent");
      console.log(`planned ${args[0]}`);
      break;
    case "met":
      await recordMeeting(graph, me, args[0], args.slice(1).join(" "));
      console.log(`remembered ${args[0]}`);
      break;
    case "recall":
      for (const r of await recall(graph, me)) console.log(`- ${r.name}: ${r.note}`);
      break;
    default:
      console.log("usage: cli <seed|meet|talks|plan <talkId> [agent]|met <personId> <note>|recall>");
  }
} finally {
  await db.close();
}
