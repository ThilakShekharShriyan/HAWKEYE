<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# HAWKEYE agent context

## Product boundary

HAWKEYE is a shared physical-world memory for a household. Phones are
observers; registered places are visual checkpoints; FalkorDB is the
authoritative store for place state, events, anchors, frames, and memory.
The answer path must be grounded in current graph state and event history.

The app has four runtime surfaces:

- Next.js App Router UI and route handlers in `app/` and `components/`.
- Pure/domain services and browser hooks in `lib/`.
- The optional RF-DETR/ByteTrack sidecar in `tracker/`.
- Demo, graph setup, replay, and verification utilities in `scripts/`.

## Architecture map

- `lib/graph.ts` is the only low-level FalkorDB connection/schema boundary.
- `lib/world-store.ts` owns persisted place, episode, frame, privacy, anchor,
  cache, and metric documents.
- `lib/events-repo.ts` owns event persistence, graph links, search, and the
  in-process event publication used by `/api/stream`.
- `lib/inventory.ts`, `lib/identity.ts`, `lib/scene.ts`, `lib/episode-logic.ts`,
  `lib/frame-diff.ts`, `lib/fast-commit.ts`, and `lib/retention.ts` contain
  deterministic business rules. Keep these pure where possible and test them
  without a database or model.
- `lib/perception.ts` is the slow model-backed episode pipeline. The live
  tracker path (`lib/tracker.ts` and `lib/fast-commit-repo.ts`) is an optional,
  conservative fast path; it must never become a second source of truth.
- `lib/*-repo.ts` modules are server-side persistence adapters. Browser hooks
  (`lib/use-*.ts`) and client components must call route handlers rather than
  importing server persistence code.
- Route handlers validate request data, coordinate services, and return stable
  JSON responses. They must not duplicate repository queries or business rules.

## Change rules

1. Read the relevant Next.js guide in `node_modules/next/dist/docs/` before
   changing App Router, route-handler, proxy, caching, or server/client-boundary
   code. The installed Next version is authoritative.
2. Use a small LLD before a cross-cutting change: state the invariant, owning
   module, inputs/outputs, failure behavior, and tests. Prefer one canonical
   implementation over parallel helpers. Do not introduce duplicate logic,
   duplicate API contracts, or duplicate persisted facts.
3. Keep the graph authoritative. Writes that affect place state and events must
   use the existing write-lock/lease conventions and remain traceable to an
   observer. Never silently swallow a failed state write.
4. Treat perception and tracking as evidence. Ambiguous detections must be
   left for the model or ignored; do not “helpfully” guess an identity or
   decrement a count.
5. Preserve privacy behavior, capture leases, demo isolation, frame limits,
   and observer boundaries. These are correctness constraints, not UI details.
6. Remove code only after checking imports, route/script entrypoints, tests,
   package scripts, and README references. Do not delete a module solely
   because it is not imported by another module: App Router routes and CLI
   scripts are roots.
7. Keep TypeScript strict and lint clean. Run `npm run typecheck`, `npm run
   lint`, and `npm test`; integration tests require FalkorDB from
   `npm run db:up`.

## Operational commands

```bash
npm run typecheck       # Next route type generation + strict TypeScript
npm run lint            # ESLint, including duplicate-import checks
npm test                # unit tests plus graph integration tests
npm run db:up           # required before graph-backed tests or scripts
npm run db:setup        # create/verify graph indexes
npm run dev             # local Next development server
```

## Known intentional tradeoffs

- The UI uses polling as a fallback because some tunnels do not carry the SSE
  stream reliably; do not remove polling without replacing that resilience.
- The tracker sidecar is optional and best-effort. If it is unavailable, the
  model episode path remains the source of truth.
- Frame and embedding retention are bounded for privacy and cost. Increasing
  retention or model calls requires an explicit product decision.
