# Playwright integration (e2e) tests

Playwright tests exercise the real Fastify app end to end: real routes,
templates, Alpine.js front end and in-memory database. The only fakes are the
Bluesky/Mastodon boundary objects.

## Running

```sh
npm run test:e2e        # builds client assets, then runs playwright test
npm run test:e2e:ui     # playwright UI mode
npm run lint            # lint covers src/ and e2e/
```

The client build is needed once (per asset change) because templates reference
the hashed bundle names (`e2e/fixtures.ts` reads `.env.client.prod` at boot).

## How the harness works (`e2e/fixtures.ts`)

- **Per test**: a fresh in-memory SQLite DB (`createDb()` + `migrateToLatest()`)
  and a real app instance built via `build()` from `src/app.ts`, listening on a
  random port. No leftover state between tests, parallel-safe.
- **Sessions**: most tests authenticate via a minted session cookie
  (`app.login(page, 'headelf')`) created with the real `TokenManager`.
  `auth.spec` tests the OTP login UI itself by reading the code from the
  `otp_login` table.
- **Fake Bluesky** (`e2e/helpers/fake-bluesky.ts`): msw intercepts the
  public appview (`resolveHandle`, `getProfile`, `getRelationships`). Any
  *other* outbound request fails the test loudly, guaranteeing nothing is sent
  to real Bluesky or Mastodon.
  Important: the msw server starts before any `src/` module is imported
  (`@atproto` captures `globalThis.fetch` at construction time).
- **Stub agents** (`e2e/helpers/stubs.ts`): the santa/robot agents record
  posts, DMs and follows instead of hitting Bluesky. Unknown methods throw.
- **Background senders are not started**; tests that check the send path call
  `app.withFixedTimeWindow(() => app.nudgeSender.sendANudge())` directly.
- **Bootstrap helpers** (`e2e/helpers/state.ts`): seed real rows (matches,
  nudges, tracking, badges, opening posts) -- no mocks, same conventions as the
  unit tests (real in-memory DB, no mock collaborators).
- External services without a fakeable seam are stubbed at module level in
  `e2e/fixtures.ts` (Google Places) or defused (bridgy-fed lookups return
  null); the firehose subscriptions are never started.

## Static test users (`e2e/helpers/users.ts`)

All users are synthetic rows seeded into the test DB -- no external accounts
are created. Key users:

| key          | role / purpose                                             |
| ------------ | ---------------------------------------------------------- |
| `headelf`    | admin elf (all `/admin` screens)                            |
| `alice`-`eve`| five regular players (auto-match needs >= 5 eligible)      |
| `supersanta` | Super Santa with several giftees                            |
| `santaonly` / `gifteeonly` | asymmetric game modes                        |
| `trouble`    | boot-out/restore target                                     |
| `shy`        | opt-out / opt back in                                       |
| `slowpoke`   | unfinished onboarding (forced address + game mode screens)  |
| `natter`     | DMs disabled on their profile (error banners, retry-DM)     |
| `oldfriend`  | badges + history for the home screen cards                  |

Known-failing specs note: earlier versions of
`e2e/admin-player-create.spec.ts` / `e2e/admin-player-badges.spec.ts` relied on
the fake inbound boundary; non-static handles now get synthesized
profiles/DIDs in `fake-bluesky`/`stubs`, and click flows use `submitAndWait`.
