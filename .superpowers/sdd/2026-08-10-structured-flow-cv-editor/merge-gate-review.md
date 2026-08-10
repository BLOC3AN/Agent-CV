# Merge-gate review: structured flow CV editor

## Verdict

**NOT READY TO MERGE**

Current `HEAD` (`3a84ca2d1c1fb9d5d04c6bc5fef25c6f4a12dd1c`) closes the prior layout-readability and registered-field/print findings, and the main explicit-save, CV-local revision, restore, export, and A4 PDF boundaries remain green. The AI provenance fix is incomplete, however: one valid AI removal crashes while provenance is being recorded, and one manual overwrite after an AI blanking change is still committed as AI-authored.

**Finding count:** 2 unresolved — 1 High, 1 Medium.

## Scope and method

- Read the prior whole-branch review, final re-review, final fix report, implementation plan, and current progress ledger.
- Inspected current source and tests at `HEAD`, with particular attention to the three previously unresolved contracts and the complete diff introduced by `3a84ca2`.
- Re-ran the full backend and frontend unit/UI suites, TypeScript checks, actual Playwright/PDF integration tests, and the v2 database round-trip check.
- Exercised two additional read-only store probes against the actual `useCVStore` implementation to cover provenance states omitted from the checked-in tests.
- Did not edit application source, tests, migrations, or database state. This review report is the only file added.

## Findings

### High

#### 1. A valid AI removal of an optional field crashes while provenance is collected

**Evidence**

- The AI patch contract supports `remove`, and the client allowlist permits registered intro and item-field paths (`frontend/apps/web-spa/src/lib/cv-patch.ts:33-56`, `68-96`). The server allowlist and proposal validation do the same (`backend/internal/api/server.go:1876-1923`, `2023-2074`).
- Several allowed fields are intentionally optional, including `website`, `careerObjective`, `availability`, `avatarUrl`, `teamSize`, `techStack`, `contribution`, `gpa`, and links (`frontend/packages/schema/src/cv.ts:31-116`). Removing one of them therefore produces a schema-valid draft.
- `collectChanges` walks the union of object keys. For a removed property, its `after` value is `undefined`; it then calls `cloneValue(undefined)`, which executes `JSON.parse(JSON.stringify(undefined))` and throws (`frontend/apps/web-spa/src/lib/cv-store.ts:125-136`).
- A fresh probe loaded a CV with `availability: "Now"`, applied the equivalent of `remove /sections/intro/availability`, and passed the valid result to the real `applyAIDraft`. The observed result was:

  ```text
  SyntaxError: "undefined" is not valid JSON
  ```

- The patch tests cover valid replacements/additions and rejection of registered-node removal, while the provenance tests cover replacements only; no test applies a valid removal of an optional CV property (`frontend/apps/web-spa/test/cv-patch.test.ts:17-49`; `frontend/apps/web-spa/test/cv-store.test.ts:190-238`).

**Impact**

A user can accept a server-approved, schema-valid proposal to remove an optional field, but the proposal fails before reaching the SPA draft. This breaks the core AI-to-draft workflow for a supported JSON Patch operation.

**Required correction**

Represent deleted values without JSON-cloning `undefined` (for example, with an explicit absence marker), reconcile absence against the exact save snapshot, and add an integration-level store regression for an accepted optional-field removal through `applyChatOpsToDraft` and `applyAIDraft`.

### Medium

#### 2. An AI change to an empty string survives an unrelated manual overwrite in provenance

**Evidence**

- Manual reconciliation keeps an AI string change when the current string contains the AI `after` value (`frontend/apps/web-spa/src/lib/cv-store.ts:146-150`). Every string contains the empty string, so an AI change whose `after` value is `""` can never be removed by later string edits.
- Empty strings are valid for multiple AI-editable string fields, including the document title and required/defaulted section strings (`frontend/packages/schema/src/cv.ts:31-65`, `145-153`; `frontend/apps/web-spa/src/lib/cv-patch.ts:21-30`).
- A fresh probe against the real store performed: AI changes title from `"CV"` to `""` → manual changes title to `"Independent manual"` → Save. The emitted commit body still contained:

  ```json
  {"source":"ai","message":"AI blanked title"}
  ```

- The new regression only covers a non-empty AI value (`"AI proposal"`) followed by an exact manual revert and later manual edit (`frontend/apps/web-spa/test/cv-store.test.ts:224-238`). It does not cover an empty AI value or a manual overwrite of that value.

**Impact**

Revision history can still label a fully manual snapshot as AI-authored and retain an AI summary even though no AI-authored value remains. This is the same provenance-accuracy contract that was the third blocker in the prior re-review.

**Required correction**

Do not use unrestricted substring matching for empty values. Model whether a string contribution actually survives, and derive source/message from contributions present in the exact save snapshot. Add a regression for AI non-empty → empty followed by an unrelated manual replacement and Save.

## Prior unresolved-item disposition

| Prior item | Status | Current evidence |
|---|---|---|
| Non-empty IDs and post-normalization readable layouts | **Resolved** | Shared item IDs and layout IDs/references require at least one character (`frontend/packages/schema/src/cv.ts:53-122`; `frontend/packages/schema/src/cv-layout.ts:17-28`). Go requires non-empty item identifiers and revalidates layout after item-order normalization (`backend/internal/api/cv_revision.go:202-245`, `319-321`, `421-467`). API coverage rejects empty IDs/references and proves normalized commit state is readable through GET (`backend/internal/api/cv_revision_test.go:494-540`). |
| Complete registered-field placement/render/printStyle behavior | **Resolved** | Every catalog field is emitted by the shared renderer in its supported section; Header-hidden/Summary-visible fallback covers registered location/availability and supported contact assets; current roles render `Present`; tags, block values, and date ranges use distinct markup/classes and print CSS (`frontend/apps/web-spa/src/components/CVBlockRenderer.tsx:53-68`, `128-223`; `frontend/apps/web-spa/src/lib/print-css.ts:1-3`). SSR and actual PDF tests verify the real envelope, fallback location/contact data, tags, current-role text, activities, and A4 output (`frontend/apps/web-spa/test/print.test.ts:52-135`; `frontend/apps/web-spa/test/print-e2e.int.test.ts:79-140`). |
| AI provenance after manual revert | **Unresolved** | The checked-in non-empty exact-revert case passes, but Findings 1 and 2 show that deletion and empty-string/manual-overwrite states are not represented correctly. |

## Regression sanity checks

- **Explicit Save:** editor updates remain local; Save/Ctrl+S uses `commitCV`; dirty download requires Save, Discard, or Cancel; clean export does not create a revision (`frontend/apps/web-spa/src/routes/BuilderRoute.tsx:24-107`, `120-170`; `frontend/apps/web-spa/test/cv-editor-save.ui.test.tsx`).
- **CV-local revisions:** current reads and API export use `cv_documents.profile_snapshot`; commits/restores atomically update the CV-local snapshot/layout and insert exact revision snapshots under optimistic concurrency (`backend/internal/api/cv_revision.go:547-572`, `631-745`; `backend/internal/api/server.go:268-315`).
- **Dirty restore:** both UI and store prevent restore before any request while a draft is dirty (`frontend/apps/web-spa/src/components/VersionHistoryPanel.tsx:181-203`; `frontend/apps/web-spa/src/lib/cv-store.ts:314-346`).
- **Export and A4 PDF:** SSR validates the real `CVEnvelope`, uses the outer authoritative layout, and renders through the shared resolver (`frontend/apps/web-spa/src/server/print.tsx:26-56`). Fresh real-PDF tests produced non-empty A4 PDFs and a multi-page long CV without clipping the final marker.

## Fresh verification

```text
cd backend && go test ./... -count=1
  PASS: all backend packages; cmd/api has no tests

cd frontend && npm test -- --run
  PASS: 26 files, 196 tests

cd frontend && npm run typecheck
  PASS: core and SPA TypeScript checks

cd frontend && npm run test:int -- --run apps/web-spa/test/print-e2e.int.test.ts
  PASS: 1 file, 2 real Playwright/PDF tests; A4 and multi-page assertions passed

cd frontend && npm run db:roundtrip-check
  PASS: 1 valid v2 profile, 0 errors

git diff --check
  PASS before this report was added
```

The frontend suite still logs the previously known non-failing `401 (Unauthorized)` request from `routing.ui.test.tsx`; it is not counted as a merge-gate finding here.

## Merge gate

Fix both provenance edge cases and add the missing remove/empty-string regressions before merge. The other two prior blockers and the requested explicit-save/revision/export/restore/A4 boundaries are ready based on current source and fresh verification.

## Round 3 fix verification

Both merge-gate findings are resolved.

- Optional-field deletion is represented as an explicit absent provenance value. `collectChanges` no longer JSON-clones `undefined`, and the regression applies a valid `remove /sections/intro/availability` through `applyChatOpsToDraft` and `applyAIDraft` while keeping the draft schema-valid.
- Provenance reconciliation now checks property presence separately from value equality. String containment is disabled for an empty AI contribution, so an empty AI value followed by a manual replacement is correctly saved as `source: user`.

Round-3 verification:

```text
cd frontend && npm run test:unit -- --run apps/web-spa/test/cv-store.test.ts apps/web-spa/test/cv-patch.test.ts
  PASS: 21 tests
cd frontend && npm run typecheck
  PASS: core and SPA TypeScript checks
```

The existing round-2 full frontend, backend, and actual Playwright/PDF checks remain green at the preceding commit; they are rerun as part of the final handoff where available.

Final handoff verification:

```text
cd frontend && npm test -- --run
  PASS: 26 files, 198 tests
cd frontend && npm run typecheck
  PASS: core and SPA TypeScript checks
cd frontend && npm run test:int -- --run apps/web-spa/test/print-e2e.int.test.ts
  PASS: 2 actual Playwright/PDF tests
cd backend && go test ./... -count=1
  PASS: all backend packages
cd frontend && npm run db:roundtrip-check
  PASS: 1 valid v2 profile, 0 errors
```
