# HAWKEYE agent notes
- Graph: FalkorDB via the `falkordb` npm client. Cypher only; FalkorDB has no `EXISTS { }` subqueries, so use `OPTIONAL MATCH ... WHERE x IS NULL`.
- Tests hit a live FalkorDB (`npm run up` first) and use a throwaway `hawkeye_test` graph.
- Ship through pull requests; Qodo reviews them. Run `npm test && npm run typecheck` before pushing.
