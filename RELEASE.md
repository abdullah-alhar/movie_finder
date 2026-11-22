# AfterShow release record

Baseline (local tree, before the release fixes): Journal build and tsc passed; ESLint reported seven unused bindings. Both Vitest workers failed on missing jsdom. Express has no build, lint or type-check script. Its test discovery included the Journal; three additional Express assertions failed (TMDB request count, IMDb rating shape, series listing).

Priority findings and fixes planned:
1. `src/app/(app)/layout.tsx`, `src/proxy.ts` and user pages: remove the preview identity and sign-in bypass. `src/app/api/cleanup/route.ts`: require a configured secret.
2. `src/lib/auth.ts`, `src/lib/db/schema.ts`: map adapter tables to the same text user IDs as journal/list ownership; baseline existing schema separately from additive auth migration.
3. `src/app/(app)/lists/[id]/page.tsx`, `src/app/api/compare/route.ts`: protect private metadata and atomically enforce guest membership.
4. `admin.js`, `server.js`, `sources.js`: remove JSON runtime persistence, process-local sessions and arbitrary outbound connection checks. Preserve the import source.
5. Separate package tests, preserve the existing Contact Sheet work, rename the Journal directory, verify builds, and document hosted cutover.
