---
name: worldstate-graph
description: Read the WORLDSTATE FalkorDB graph before answering who has what, who took it, or what to buy. Use when the question is about a place, an item count, or a change.
---

# WORLDSTATE graph

The graph name is `worldstate` unless `FALKORDB_GRAPH` says otherwise.

Places are `(:Place {kind:'container'})`. A second table is its own Place (`table`, `table 2`), not a property of the first.
Each physical object is a `(:Thing)` in a `(:Slot)` via `[:IN]`. Its kind is `(:Item)` via `[:KIND]`.
A taken thing is a ghost: `(:Observer)-[:TOOK]->(:Thing)-[:WAS_IN]->(:Place)`.
Items a place holds right now are `(:Item)` via `[:HOLDS {count}]`, projected from the live things.
Observers are `(:Observer)`. A sighting is `(:Observer)-[:SAW]->(:Event)-[:ABOUT]->(:Place)` and `(:Event)-[:OF]->(:Item)`.
Long-term memory is `(:Fact)`, `(:EpisodeMemory)` and `(:Term)`.

Answer from a path, not a guess. For "who took the coke from the fridge":

```cypher
MATCH (o:Observer)-[:SAW]->(e:Event)-[:ABOUT]->(p:Place {name:'fridge'})
OPTIONAL MATCH (e)-[:OF]->(i:Item)
WHERE e.type = 'transition' AND (i.name CONTAINS 'coke' OR e.summary CONTAINS 'coke')
RETURN o.id, e.title, e.summary, p.name, i.name
ORDER BY e.ts DESC
LIMIT 5
```

Current contents:

```cypher
MATCH (p:Place {kind:'container'})-[h:HOLDS]->(i:Item)
RETURN p.name, i.name, h.count
```

If FalkorDB is not connected from this session, use the world state already written in the user message. Do not invent counts.
