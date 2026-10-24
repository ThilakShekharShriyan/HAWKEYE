# Patch the Conference submission

**Project:** HAWKEYE · **Repo:** https://github.com/ThilakShekharShriyan/HAWKEYE ·
**Video:** https://youtu.be/NG2yeaObvtk · **Tracks:** FalkorDB, TrueFoundry with OpenAI, Qodo

## What conference problem are you patching?

Conferences and hackathons run on shared physical spaces nobody keeps track of: a team's table, a
sponsor's swag booth, the snack and supply tables, a shared team room. Nobody knows what is left, who
took the last one, or what needs restocking, and what one person notices is lost when they walk away.
HAWKEYE gives a shared space a memory: any teammate's phone is an observer, a spot becomes a shared
place with one voice command, and anyone can ask what is there or what happened without walking over.

## What did you build and how does it work?

A shared spatial memory kept in a FalkorDB graph and updated by a mesh of phone cameras.

1. **Remember a place.** "Hey Hawkeye, remember this table": an OpenAI vision model counts what is on
   it, and the table becomes a `Place` with `HOLDS {count}` links to each item, linked to the phone.
2. **The mesh keeps it current.** Any phone that sees the place again is recognised by sight and
   compared with the stored contents; a taken item lowers the count and writes a `Taken` event with
   whose camera saw it. A live object tracker (RF-DETR + ByteTrack) can commit a change about a
   second after a hand leaves; the vision pass corrects it, under the same write lock.
3. **Ask from anywhere.** A TrueForge agent on OpenAI answers from the graph, reading it read-only
   through the FalkorDB MCP server.

Stack: Next.js 16, FalkorDB (graph, vector and full-text indexes, agent memory), TrueForge on OpenAI
gpt-5.5, ElevenLabs voice, a Python tracker sidecar, and a 3D graph view of the household at `/house`.

## FalkorDB

- **Multi-hop:** `(Person)-[:CARRIES]->(Observer)-[:WATCHES]->(Place)-[:HOLDS {count}]->(Item)`;
  `(Person)-[:CARRIES]->(Observer)-[:SAW]->(Event)`; the household as
  `(Person)-[:LIVES_IN]->(House)-[:HAS_AREA]->(Area)-[:HAS_SITE]->(Place)` with shared
  `(Person)-[:RESPONSIBLE_FOR]->(Duty)-[:COVERS]->(Area)`.
- **Shared state:** two phones write one graph; the vision pipeline and the tracker write counts under
  one lock; the TrueForge agent reads the same graph through the MCP.
- **Memory:** events indexed for vector and full-text search; the assistant's facts and conversations
  persist across sessions.
- **Showing the path:** the Stage demo queries in the README draw the place, both phones and its items,
  and list every event at the place with whose phone saw it.

## TrueFoundry and OpenAI

The `worldstate-answer` agent is registered through the TrueForge SDK (`npm run trueforge:setup`) with
OpenAI gpt-5.5, attached to the FalkorDB MCP server with read-only tools only. Each question is a
TrueForge session. The graph skill in `trueforge/skills/worldstate-graph` attaches once the repo is
public; the sandbox uses TrueForge's local fallback. OpenAI does vision on every sighting (which place,
counts, coverage, what changed), writes the spoken answers, and embeds events for vector search.

## Qodo

Every change shipped as a Qodo-reviewed pull request with its findings fixed: #2 through #11
(https://github.com/ThilakShekharShriyan/HAWKEYE/pulls?q=is%3Apr).
