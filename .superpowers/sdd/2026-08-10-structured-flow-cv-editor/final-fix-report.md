# Structured Flow CV Editor — final fix report

Date: 2026-08-11 (Asia/Ho_Chi_Minh)  
Branch: `main`  
Starting commit: `ecdc190611911a1e6d0830729448dd1166d31d6b`

## Status

All Critical and High findings 1–8 were fixed with production code and boundary tests. Medium findings 9–11 were also fixed in this pass. No database migration was required: the existing JSONB columns support the canonical fields/layout and migration 014 already provides revision storage and numbering.

## Finding resolution

1. **Real SSR envelope:** `/print/:cvId` now unwraps `cv.profileSnapshot`, applies the authoritative outer `cv.layout`, validates both shared schemas, rejects malformed upstream JSON with 502, and renders the actual `CVEnvelope` contract. Unit and Playwright PDF fixtures now use that production shape.
2. **CV-local authority:** GET and API export read `cv_documents.profile_snapshot`, not `profiles.data`. Commit/restore update only CV-local current state and CV revisions. Legacy v2 PATCH remains available for initial creation while revision count is zero, but returns 409 once history exists; metadata PATCH cannot rewrite layout.
3. **Optimistic concurrency/exact response:** commit and restore require `baseRevision`, compare it under the CV row lock, and return `409 CV_REVISION_CONFLICT` when stale. Responses are built from the exact inserted revision snapshot and locked metadata rather than a later mutable reload. Concurrent-writer, stale-save, stale-restore, and response-pair tests cover the boundary.
4. **Explicit download decision:** clean documents print directly. Dirty documents require Save and download, Discard and download, or Cancel. Preview download no longer commits implicitly. Save is the only option that creates a revision.
5. **Dirty restore guard:** restore controls are disabled with actionable guidance while dirty, and the store independently rejects dirty restore before any HTTP call.
6. **Renderer completeness:** activities is a canonical node and is implemented in the editor, preview, browser print, and SSR print resolver. Supported section fields and every registered catalog field render across all variants; catalog `printStyle` is emitted at render boundaries. Actual PDF text asserts activities and registered content.
7. **Canonical layout integrity:** TypeScript and Go now require exactly one node for each of the ten canonical types, canonical `id === type`, unique nodes, unique nested references, and no unknown properties. Commits cross-check `itemOrder` against CV item IDs and deterministically append unlisted items. Legacy nine-node/empty layouts are normalized for GET, history preview, and restore.
8. **Strict AI patches:** CV object boundaries are strict, both client and server use explicit patch-path allowlists, destructive registered-node operations and compatibility visibility writes are rejected, forbidden design fields are rejected, and parsed schema output—not the unvalidated patched object—is returned.
9. **Visibility synchronization:** layout visibility is the renderer/tree authority. Legacy `activeSections` flags are folded into layout once on read and are synchronized from layout on local updates and commit.
10. **Typed canonical fields:** availability, team size, technology stack, and contribution have independent typed storage. Headline aliases and magic highlight markers were removed; marker-like user bullets remain ordinary bullets.
11. **Versioned AI provenance:** provenance lives in the store, survives mixed manual edits, is snapshotted per save, clears only entries included in that successful snapshot, survives newer AI work accepted during an in-flight save, and ignores no-op AI applications.

## Backward compatibility

- Legacy v2 initialization through explicit `saveCV` remains supported before the first CV revision, which preserves New CV and Guided creation flows.
- Legacy empty/partial nine-node layouts are normalized without mutating source rows during reads.
- Historical revisions with pre-activities layouts are normalized for preview and are committed as a new canonical revision when restored.
- Source profile edits no longer alter existing CV documents or exports implicitly.

## Verification

Passing checks:

- `cd backend && go test ./... -count=1` — all Go packages passed (`cmd/worker`, `internal/api`, `internal/pii`; `cmd/api` has no tests).
- Backend focused revision/authority/layout/AI tests — passed, including concurrent commits, stale restore, CV-local GET/export, legacy PATCH guard, canonical item references, exact response pairing, and legacy history normalization.
- `cd frontend && npm test` — broad unit/UI checkpoint passed: **26 files, 190 tests**.
- Final focused source/boundary checks after the broad checkpoint:
  - schema/render/print/store: **24 tests passed**;
  - explicit Save/Discard/Cancel download workflow: **11 tests passed**;
  - earlier combined Critical/High boundary slice: **9 files, 81 tests passed**.
- `cd frontend && npm run typecheck` — core and SPA TypeScript checks passed.
- `npx vitest run --project integration apps/web-spa/test/print-e2e.int.test.ts` — **2/2 passed**; generated A4 PDFs, preserved long multi-page content, and extracted activity/registered-field text from the real-envelope SSR route.
- `SPA_BASE_URL=http://localhost:3000 npx vitest run --project integration apps/web-spa/test/smoke.int.test.ts` — **4/4 passed** against the configured cutover port.
- Current database migration, v2 round-trip, and profile/CV pair checks passed.
- Isolated clean database rehearsal passed all **16/16 migrations** after applying the repository's required `db/init/001_extensions.sql` bootstrap; the temporary database was then dropped.
- `git diff --check` — passed.

Non-code verification issues observed:

- Running the aggregate integration command with its obsolete default `http://localhost:3002` produced four smoke `ECONNREFUSED` failures; the repository's running SPA is cut over to port 3000. The same smoke file passed 4/4 with `SPA_BASE_URL=http://localhost:3000`; KB integration passed 23/23 and print integration passed 2/2 in that aggregate run.
- `npm run lint` did not reach source diagnostics: ESLint 9.39.5 exited while loading configuration with `SyntaxError: Unexpected token '{'`. TypeScript and all relevant test suites above passed.

## Residual concerns

- There is still no single browser test that combines authenticated SPA interaction, the real Go API, PostgreSQL revision writes, and final Playwright PDF generation in one scenario; these boundaries are now covered by separate backend, UI, SSR, and PDF integration tests.
- The strict CV contract is duplicated between Zod and hand-written Go normalization. Cross-language fixtures added here reduce drift risk, but generation from one schema would be a longer-term improvement.
- `cv_revisions.parent_revision_id` remains a database-level foreign key to any revision row rather than a composite same-CV constraint. Application code always supplies a same-CV parent.
- The integration smoke default port and ESLint configuration/runtime mismatch are repository tooling issues outside findings 1–11.

## Round 10 follow-up

The two findings in `FINAL-MERGE-REVIEW-CURRENT.md` are resolved in the provenance collector/reconciler:

- Primitive reorder detection now compares the relative order of matched baseline tokens. Leading or middle removals that are later restored no longer look like a reorder.
- Primitive-array add and remove deltas are collected independently of net length, while order is tracked independently as well. Order markers retain the post-AI values they represent, so removing an AI replacement can clear only that value contribution while preserving a surviving reorder contribution.

Added regressions cover leading and middle removal restoration, mixed remove/add net growth and shrink, and mixed reorder/replacement after only the replacement is removed. The focused store suite passes 34/34; the full frontend suite passes 218/218; frontend typecheck, `go test ./...`, and real Playwright print integration (2/2) pass. `git diff --check` passes.
