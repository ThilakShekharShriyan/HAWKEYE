# HAWKEYE

**Roommate and room tracking.** HAWKEYE is built on WORLDSTATE: every room, shelf and fridge becomes a shared checkpoint in a FalkorDB graph, and every roommate's phone is an observer that keeps it up to date. Ask who took the last coke, what the house is out of, or who ate the leftovers, and the answer comes from the graph.

The rest of this README describes the underlying WORLDSTATE engine.

**Geospatial checkpoints for the physical world, kept up to date by a mesh of
observers.**

## The problem

Software knows where everything is. The physical world does not.

- **No shared checkpoints.** Nothing in a room has an address a device can
  look up. "The fridge" or "the table by the door" means something to people,
  but two phones have no common way to say "this is that same place".
- **State goes stale.** What is on a shelf changes every time someone walks
  past. One person sees the change; nobody else knows until they go and look.
- **Every camera starts from zero.** What one device saw stays on that device.

So simple questions have no answer: how many are left, who took the last one,
do we need to buy more.

## Our answer

**Geospatial checkpoints.** Say "Hey Hawkeye, remember this" and that spot
becomes a geospatial checkpoint: a real place in the world, saved with its
current state in a FalkorDB graph. Checkpoints are global. Every device loads the
same ones, so any phone that sees that place later knows it is the same
checkpoint. They are recognised by sight rather than by coordinates, so they
work indoors and can be as small as a single shelf.

**A mesh of observers.** Each phone is an observer, and together they form a
mesh. Whenever any observer sees something change at a checkpoint, it updates
that checkpoint's shared state, and the update reaches every other observer
straight away. No device holds its own copy, so a checkpoint is always as
fresh as the last thing any observer saw.

**Ask from anywhere.** Because every checkpoint is shared and current, you can
ask about a place you are not standing in:

> "Hey Hawkeye, how many coke cans are left on the table?"
> "Two. Observer 02 took one a few minutes ago."

## Demo

[![Watch the WORLDSTATE demo](https://img.youtube.com/vi/y532iVUl6y4/hqdefault.jpg)](https://youtu.be/y532iVUl6y4)

[Watch the demo on YouTube](https://youtu.be/y532iVUl6y4)

## How it works

**1. Create a geospatial checkpoint.**
Point a phone at a place and say "Hey Hawkeye, remember this". HAWKEYE saves
the checkpoint and counts what is there.

**2. The mesh keeps it updated.**
Any observer that sees the checkpoint again recognises it. When someone takes
or adds something, the checkpoint's state is updated and HAWKEYE notes
which observer saw it.

**3. Ask from anywhere.**
Ask a question by voice. The answer is spoken back, and it comes from the
checkpoint's latest state, not from a guess.

A dashboard on a laptop shows every observer's camera, a live feed of what
changed, and a page for each checkpoint with its history.

## Run it with TrueForge

```bash
npm run db:up              # FalkorDB on :6390, browser on :3010
npm run seed:demo          # a shared house: fridge and snack shelf, who took what
npm run trueforge          # TrueForge harness, UI on :8790 (separate terminal)
npm run mcp:falkor         # FalkorDB MCP over HTTP on :3006 (separate terminal)
npm run trueforge:setup    # registers the OpenAI model, the MCP server and the agent
# in .env.local: OPENAI_API_KEY, OPENAI_MODEL=gpt-5.5, TRUEFORGE_AGENT=1
npx next dev -p 3100
```

Ask: `curl -X POST localhost:3100/api/ask -H 'content-type: application/json' -d '{"observerId":"01","text":"Hey Hawkeye, who took the last coke?"}'`.
Each question opens a TrueForge session, so it shows up in the harness UI.


## The house in 3D

`npm run seed:demo` builds the demo house in FalkorDB, and `/house` draws it with
[3d-force-graph](https://github.com/vasturiano/3d-force-graph). Open
`http://localhost:3100/house` (or your dev port), drag to orbit, click a node.

```
(Person)-[:LIVES_IN]->(House)-[:HAS_AREA]->(Area)-[:HAS_SITE]->(Place)-[:HOLDS {count}]->(Item)
(Person)-[:ROOMMATE_OF]->(Person)
(Person)-[:RESPONSIBLE_FOR]->(Duty)-[:COVERS]->(Area)
(Person)-[:CARRIES]->(Observer)
```

Two roommates, Thilak and Arnav, share three areas: Kitchen (fridge, dishwasher,
microwave, oven), Laundry (dishpods, lint roller, stain removers and boosters)
and Household (bleach spray, bounty). The sites are the same `Place` nodes the
cameras update, so a sighting changes what you see. The data lives in
`lib/house-graph.ts`; the counts are sample data. The page refreshes every 5 seconds.
## Live tracking (optional)

A small Python sidecar (`tracker/server.py`, RF-DETR detection and ByteTrack from
roboflow/trackers) follows people and portable things (bottles, cups, laptops,
bags) in each phone's feed at a few frames a second, with stable IDs and trails.
The dashboard draws the boxes over the camera feed.

When the tracker sees a hand reach in and leave, and the count of an object the hand
touched has changed, HAWKEYE writes the new count to FalkorDB straight away (about a
second) instead of waiting for the vision model: the place document and its
`HOLDS {count}` link, plus a "Taken" or "Added" event. The slower model episode runs
afterwards and corrects anything this got wrong. Both take the same write lock, so a
bottle leaving is recorded once.

```bash
npm run tracker:setup      # one time: Python 3.12 venv with rfdetr and trackers
npm run tracker:dev        # sidecar on :8766 (TRACKER_PORT to change)
# in .env.local: TRACKER_URL=http://localhost:8766 and TRACKER_LIVE=1
```

The detector only knows common objects, so it cannot count snack bars or a particular
can: for those, the vision model stays the source of the count. With no sidecar running
the app behaves as before.

## MCP servers for a coding agent (optional)

`.mcp.json` lists the servers a coding agent (Claude Code, Cursor) can use here:
FalkorDB, Next.js devtools, Qodo and ElevenLabs. The app does not need them.

- **Node (`npx`)** runs the FalkorDB and Next.js servers. **`uv` (`uvx`)** runs the ElevenLabs
  server: install it with `brew install uv` (or see https://docs.astral.sh/uv/) and check it
  with `uvx --version`.
- The Qodo and ElevenLabs entries read `QODO_API_KEY` and `ELEVENLABS_API_KEY` from the
  environment of the agent, not from `.env.local`. Export them in the shell you start the
  agent from, then restart it:

```bash
set -a; source .env.local; set +a   # exports every key in .env.local
claude                               # or open your editor from this shell
```

## What you can ask

- "How many eggs are left?"
- "Who took the last coke?"
- "What should I buy?"
- "How fast do we go through milk?"
- "Did I already take my pills?"

Say "ignore this" and the camera stops remembering for five minutes.

## Use cases

| Use case | What it does |
| --- | --- |
| Home inventory | Know what is in the fridge without opening it |
| Shopping list | Lists what is out, or will run out within two days |
| Who took it | Every change is saved with the observer that saw it |
| Medication and routines | Check whether something was already taken today |
| Freshness | Estimates how long perishables have been sitting there |
| Shared spaces | One memory for housemates, an office snack table, a team fridge |
| Stock rooms, lab benches, tool walls | Same idea, anywhere things are kept and counted |

Two honest limits: freshness is an estimate from how long an item has been
seen, not a printed date. And we have only tested at home scale.

## Tech

**App**
- Next.js 16, React 19, TypeScript, Tailwind CSS 4

**Data and memory**
- FalkorDB for the graph: places, items, observers, events and long-term memory
- Vector search and full-text search on events, with OpenAI embeddings
- TrueForge, on OpenAI, for the answer agent

**AI models**
- OpenAI `gpt-5.4-mini` to read photos and answer questions
- Gemini as a drop-in alternative
- Groq for faster text-only answers

**Voice and camera**
- ElevenLabs for speech-to-text and text-to-speech
- MediaPipe, running in the browser, to spot fridges, tables and saved checkpoints
- WebRTC to send phone video to the dashboard

**Tests**
- Vitest

## Sponsor tech: Patch the Conference

Built for the
[Patch the Conference hackathon](https://www.wemakedevs.org/hackathons/ptc)
(Bright Data, San Francisco, Oct 24 2026). The product is still a mesh of
observers keeping physical places up to date. The stack under it is the
sponsor tools for that day.

| Sponsor | What we use it for |
| --- | --- |
| FalkorDB | The only database. Places hold items, observers saw events, and every "who took it" answer is a Cypher path |
| FalkorDB vector + full-text | Finding the right past events for a question, by meaning and by keyword |
| FalkorDB MCP | Lets a coding agent query the graph (`@falkordb/mcpserver`) |
| Bright Data SERP API | Live Google results when someone asks what to buy |
| TrueForge + OpenAI | The answer agent. `npx @truefoundry/trueforge` runs the loop; the SDK calls it; OpenAI is the model |
| Qodo | Reviews pull requests. Install the GitHub app; `.pr_agent.toml` says what to look for |

A question such as "who took the coke from the fridge" walks
`(Observer)-[:SAW]->(Event)-[:ABOUT]->(Place)` and `(Event)-[:OF]->(Item)`.
What the place holds right now is `(Place)-[:HOLDS]->(Item)`. That path is
what the spoken answer is based on. The graph browser is at
`http://localhost:3010` while the app is on port 3000.

## Run it

You need Node.js, Docker, an OpenAI (or Gemini) key and an ElevenLabs key.

```bash
npm install
cp .env.example .env.local   # then fill in your keys
npm run db:up                # FalkorDB on :6390, browser on :3010
npm run db:setup             # indexes on the worldstate graph
npm run dev
```

Then:

1. Open the dashboard at `http://localhost:3000`. Keep this tab visible.
2. Phones need HTTPS for the camera, so start a tunnel: `ngrok http 3000`.
3. On each phone open `https://<tunnel>/observe/01` (or `/observe/02`) and tap
   **Start observing**.

No phones handy? Open `http://localhost:3000?demo=1` for a scripted demo.

If something looks wrong, `http://localhost:3000/api/health` shows what is
connected.

### Optional extras

Each of these is off until you set its keys. `.env.example` explains every one.

| Extra | Set this | What you get |
| --- | --- | --- |
| TrueForge | `npm run trueforge`, then `npm run mcp:falkor` and `npm run trueforge:setup`, then `TRUEFORGE_AGENT=1` | Questions answered by the saved `worldstate-answer` agent |
| Bright Data | `BRIGHT_DATA_API_KEY`, `BRIGHT_DATA_ZONE` | Live listings when someone asks what to buy |
| Groq | `LLM_PROVIDER=groq`, `GROQ_API_KEYS` | Faster text answers |
| TURN relay | `NEXT_PUBLIC_TURN_*` | Video on networks that block direct connections |

## Tests

```bash
npm test             # unit tests
scripts/logs.sh -f   # follow the debug log
```

To replay the demo against a running server with two photos:

```bash
node scripts/demo-check.ts before.jpg after.jpg table "coke can"
```

This writes to your graph. Set `FALKORDB_GRAPH=worldstate_e2e` to keep test data
separate.

## Where things are

| Folder | What is in it |
| --- | --- |
| `app/` | Pages (dashboard, places, phone observer) and API routes |
| `components/` | UI for the dashboard, places and phone |
| `lib/` | The logic: reading photos, counting, memory, trends, model providers |
| `trueforge/` | TrueForge agent spec and the graph skill |
| `scripts/` | Database setup, demo check, video replay, logs |
| `tests/` | Unit tests and the demo videos |

## Team

- Arnav Dewan ([@arnxv0](https://github.com/arnxv0))
- Thilak Shekhar Shriyan ([@ThilakShekharShriyan](https://github.com/ThilakShekharShriyan))
