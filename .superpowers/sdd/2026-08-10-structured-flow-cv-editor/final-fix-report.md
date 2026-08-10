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

## Round 11 follow-up

The findings in `FINAL-MERGE-REVIEW-6.md` are resolved:

- Primitive reorder provenance now stores AI-authored pairwise relations derived from multiplicity-aware baseline token matching. Exact baseline restoration, baseline-ordered surviving subsets, and single-marker remnants clear attribution; duplicate-valued arrays retain attribution only when an AI-inverted relation remains.
- Consecutive AI proposals are reconciled against the committed-to-draft net change before a new provenance entry is recorded. A later AI proposal that restores the committed scalar or array state therefore contributes no AI metadata, while surviving newer work and the existing in-flight save snapshot behavior remain intact.

Round-11 regressions cover all five order probes plus scalar and primitive-array AI cancellation. Verification passed: focused store 41/41, full frontend 26 files / 225 tests, frontend typecheck, `go test ./...`, and real Playwright/PDF print integration 2/2. `git diff --check` is clean.

## Round 12 follow-up

The findings in `FINAL-MERGE-REVIEW-7.md` are resolved:

- Primitive order relations retain baseline occurrence tokens. Reconciliation first checks a multiplicity-aware token embedding and only uses the prior value fallback for a non-duplicated reordered source, so duplicate reorder survival, exact restoration, and duplicate-count reduction have distinct outcomes.
- Same-path consecutive AI changes now require newly introduced scalar content beyond the immediate draft and committed value. A proposal that only removes an earlier AI fragment from a manual residual is not recorded as AI provenance; genuinely new AI text and in-flight save provenance remain supported.

Added regressions cover duplicate reorder survival, exact restoration, count reduction, and same-path scalar cancellation. Verification passed: focused store 45/45, full frontend 26 files / 229 tests, frontend typecheck, `go test ./...`, and real Playwright/PDF print integration 2/2. `git diff --check` is clean.

## Round 13 follow-up

The finding in `FINAL-MERGE-REVIEW-8.md` is resolved:

- Same-path scalar cancellation filtering now checks whether an earlier AI provenance entry existed on that exact path before suppressing substring-only changes. Standalone AI truncation and blanking therefore remain AI-attributed, while the earlier AI-fragment/manual-residual/AI-cancellation sequence still clears.

Added AI-only truncation and blanking regressions while retaining the cancellation regression. Verification passed: focused store 47/47, full frontend 26 files / 231 tests, frontend typecheck, `go test ./...`, and real Playwright/PDF print integration 2/2. `git diff --check` is clean.

## Round 14 follow-up

The findings in `FINAL-MERGE-REVIEW-9.md` are resolved:

- Prior scalar provenance is matched by stable item ID, collection, and logical field path when available, with raw-path matching retained for non-item fields. Same-field cancellation therefore survives supported stable-ID item reorders.
- Cancellation suppression now removes only a prior, non-in-flight AI scalar contribution when the resulting value is exactly the residual left after that contribution is removed. Later shortening/blanking of the manual residual remains AI-attributed, and entries captured by an older in-flight save do not suppress newer AI work.

Added regressions cover stable-ID reorder cancellation, residual shortening, residual blanking, and newer in-flight AI blanking. Verification passed: focused store 51/51, full frontend 26 files / 235 tests, frontend typecheck, `go test ./...`, and real Playwright/PDF print integration 2/2. `git diff --check` is clean.

## Round 15 follow-up

The findings in `FINAL-MERGE-REVIEW-10.md` are resolved:

- Scalar provenance now derives the older AI-added delta from its `before`/`after` common prefix and suffix rather than treating the complete post-AI value as authored by AI. This correctly cancels an AI suffix while preserving committed/manual text, while later removal of committed text remains AI-attributed.
- Failed in-flight saves rebase the captured older entries together with newer entries against the unchanged committed baseline before retry. Successful saves continue to promote the captured snapshot and preserve newer provenance.

Added regressions cover baseline-preserving suffix cancellation, committed-content removal, in-flight success, and failed-save cancellation reclassification. Verification passed: focused store 55/55, full frontend 26 files / 239 tests, frontend typecheck, `go test ./...`, and real Playwright/PDF print integration 2/2. `git diff --check` is clean.

## Round 16 follow-up

The findings in `FINAL-MERGE-REVIEW-11.md` are resolved:

- Scalar provenance now records both the removed-before span and inserted-after span with their shared position. Reconciliation can distinguish cancellation of only an earlier AI fragment from a later AI removal of committed/manual content, including replacement and removal cases.
- Failed-save rebasing applies the same scalar-delta model against the unchanged committed baseline. An exact cancellation accepted while a save is in flight is reclassified as user content after failure, while surviving newer AI work remains attributed.
- AI proposals accepted during an in-flight save are retained provisionally even when their result equals the stale pre-save baseline. Save success rebases them against the actual committed response, preserving exact AI restoration on the newer revision; failure clears an exact restoration against the unchanged committed baseline and retains no stale AI message.

Added normal and failure regressions for scalar replacement/removal residuals, scalar exact restoration, and primitive-array exact restoration during an older in-flight save. Verification passed: focused store **61/61**, full frontend **26 files / 245 tests**, frontend typecheck, `go test ./...`, real Playwright/PDF print integration **2/2**, smoke integration **4/4** with `SPA_BASE_URL=http://localhost:3000`, and `git diff --check`.

## Round 17 follow-up

The findings in `FINAL-MERGE-REVIEW-12.md` are resolved:

- Scalar provenance now reconciles occurrence candidates rather than unqualified substring presence, first-occurrence replacement, or stale absolute positions. Insertions/replacements retain multiplicity-aware occurrence anchors; removals locate the matching surviving occurrence and cancellation candidates are rebased through manual prefixes/shifts. The same cancellation model is applied before failed-save entries are reconciled, so an older in-flight contribution can be removed when a newer proposal restores only its manual residual.
- Successful saves now rebase every newer provisional entry against the actual committed response and the current draft. Entries whose effect is already in the response are cleared, while stale-baseline restorations remain only when they are a real committed-to-current delta. This applies to scalar and stable-ID primitive-array changes.

Added regressions for duplicate scalar insertion undo, shifted removal cancellation, surviving removal with repeated text elsewhere, normal and failed-save flows, plus scalar and primitive-array net-zero provisional provenance after successful saves. Verification passed: focused store **67/67**, full frontend **26 files / 251 tests**, frontend typecheck, `go test ./...`, real Playwright/PDF print integration **2/2**, smoke integration **4/4** with `SPA_BASE_URL=http://localhost:3000`, and `git diff --check`.
