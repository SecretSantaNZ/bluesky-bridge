# Testing Guidelines

## Definition of Done
- Always run `npm run lint` before declaring a task done, and confirm there are no lint errors or warnings.

## Unit Tests
- Use in-memory SQLite databases (`createDb()` + `migrateToLatest(db)`) for database-dependent tests. Follow the pattern in `src/lib/database/nudge.test.ts`.
- Do **not** mock collaborators like `getRandomMessage`, `loadSettings`, or other internal modules. Test with real implementations and real data seeded into the in-memory database.
- Only mock external interactions (e.g. `@atproto/api` for posting to Bluesky). Use mocks only when hitting real external services/network is unavoidable.
- When constructing test data, create real rows (players, matches, nudges, etc.) in the in-memory DB rather than building mock DB query chains.
