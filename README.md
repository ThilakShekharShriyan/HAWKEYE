# HAWKEYE

A conference intelligence agent for **Patch the Conference** (WeMakeDevs). It sees the whole conference as one graph (people, talks, topics, companies, and who you've already met) and answers with the path it used.

Built on **FalkorDB** (Track 1). Reviewed by **Qodo** (Track 4).

## Why a graph
- **Multi-hop**: `me → topic ← person → company` finds who to meet. `me → topic ← talk → slot` finds talks that don't clash with your plan.
- **Explainable**: every answer carries a `why` built from the matched graph path.
- **Memory across sessions**: `(:Person)-[:MET {note, at}]->(:Person)` persists, so people you've met stop being suggested.
- **Shared state between agents**: planner and networking agents write `PLANS_TO_ATTEND {by}` into the same graph.

## Run
```bash
npm install
npm run up        # FalkorDB on :6390, Browser UI on http://localhost:3010
npm run seed
npm run hawkeye meet
npm run hawkeye talks
npm run hawkeye plan t2 planner-agent
npm run hawkeye met ana "talked agent memory"
npm run hawkeye recall
npm test
```

Copy `.env.example` to `.env.local` to override the host, port or graph name.
