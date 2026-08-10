# Final merge-gate review 5: structured flow CV editor

Date: 2026-08-11 (Asia/Ho_Chi_Minh)  
Reviewed HEAD: `7c762e330c0198e36c5060b1ee2ccc6bc879b87c` (`fix: stabilize nested array provenance`)

## Verdict

**NOT READY TO MERGE**

The concrete failures reported at `e3d5ed2` are corrected on the actual current HEAD: AI reorder provenance survives a manual append while clearing on baseline-order restoration, AI-created optional arrays retain element provenance through later edits, nested AI additions follow stable-ID items through reorder/removal of earlier items, and restoring a baseline string that contains the AI result clears attribution. The prior explicit Save, CV-local revision/restore, layout, shared-renderer, SSR, and real A4 PDF boundaries also remain green.

One residual supported array case keeps the gate closed. Equal-length primitive-array replacements are still represented by a numeric nested field path. If a later manual prepend or reorder shifts the unchanged AI replacement inside its stable-ID parent item, reconciliation loses it and Save incorrectly emits a user-authored revision.

**Finding count:** 1 unresolved — 1 Medium.

## Scope and method

- Pinned the review to the live `HEAD` above and confirmed a clean worktree before creating this report.
- Inspected the `e3d5ed2..7c762e3` fix and regressions directly, then reviewed the current store, patch allowlist, explicit-Save routes, revision/restore transaction boundary, layout schemas, shared renderer, SSR print handler, and PDF tests.
- Ran all five new regressions for the two prior findings and exercised an additional supported operation through the real `applyChatOpsToDraft` + `useCVStore` + outgoing commit workflow.
- Ran fresh focused and full frontend tests, TypeScript checks, the production SPA/server build, full and verbose backend/API tests, real Playwright/PDF tests, and the database round-trip check.
- Did not edit application source, tests, migrations, or database records. This report is the only intended repository write.

## Prior finding disposition

### Nested and optional array cases reported in review 4: resolved

- Arrays created from an absent optional property are decomposed into element additions with zero baseline multiplicity (`frontend/apps/web-spa/src/lib/cv-store.ts:146-150`). The checked-in regression creates `techStack`, manually appends another value, and preserves AI source/message on Save (`frontend/apps/web-spa/test/cv-store.test.ts:410-425`).
- Nested array changes with stable item identity resolve the owning collection and item before resolving the relative nested-array path (`frontend/apps/web-spa/src/lib/cv-store.ts:240-255`). The two regressions preserve the AI addition after the item is reordered and after an earlier item is removed (`frontend/apps/web-spa/test/cv-store.test.ts:427-459`).
- Reorder reconciliation now checks whether the post-AI order remains as a relative-order subsequence rather than requiring exact whole-array equality (`frontend/apps/web-spa/src/lib/cv-store.ts:257-265`). The manual-append regression preserves attribution, while the baseline-order restoration regression clears it (`frontend/apps/web-spa/test/cv-store.test.ts:342-357`, `393-408`).
- Fresh focused verification passed all 32 store/patch tests, including the five new inverse cases.

These corrections close every concrete array reproduction from review 4. The finding below shows that the broader supported nested-array contract is not complete for equal-length element replacement.

### Baseline-aware string provenance: resolved

- Provenance now retains the pre-AI value, and string containment is accepted only when the current value differs from that baseline (`frontend/apps/web-spa/src/lib/cv-store.ts:116-125`, `225`, `289-292`).
- The regression performs `"Senior Engineer"` -> AI `"Engineer"` -> manual restoration of `"Senior Engineer"` plus an unrelated edit, then requires a user-sourced Save without the AI summary (`frontend/apps/web-spa/test/cv-store.test.ts:461-475`).
- The positive mixed-edit case remains covered: a manual extension that still contains a non-empty AI contribution remains AI-attributed, including across an in-flight save (`frontend/apps/web-spa/test/cv-store.test.ts:191-209`).

## Finding

### Medium — A surviving nested-array replacement loses provenance after a manual index shift

**Evidence**

- For equal-length primitive arrays whose multisets differ, `collectChanges` still recurses by numeric index (`frontend/apps/web-spa/src/lib/cv-store.ts:183-211`). A replacement inside a stable-ID item is consequently recorded with both the stable item identity and a relative field path that includes the old nested index, such as `/techStack/0` (`frontend/apps/web-spa/src/lib/cv-store.ts:220-225`).
- Reconciliation follows the stable-ID parent item but then resolves that complete positional field path and returns immediately (`frontend/apps/web-spa/src/lib/cv-store.ts:270-276`). The parent-array value fallback at `278-282` is never reached for this change shape, so the AI value is not followed when it moves within the same nested array.
- This is a supported workflow: the patch allowlist permits replacing individual `highlights`, `skills`, and `techStack` elements (`frontend/apps/web-spa/src/lib/cv-patch.ts:38-45`), and the manual editors may reorder or prepend values.
- A fresh public-store probe against the actual current source performed: baseline `techStack: ["Go", "React"]` -> valid AI `replace /sections/experience/0/techStack/0` with `"Rust"` -> manual prepend `"Manual"` -> explicit Save. The exact AI value survived, but the outgoing commit was:

  ```json
  {
    "savedArray": ["Manual", "Rust", "React"],
    "source": "user",
    "message": null
  }
  ```

- An independent probe loading and transpiling the exact current `collectChanges` and `reconcileProvenance` functions recorded `/techStack/0`, confirmed `"Rust"` remained in the current array, and returned zero retained provenance entries.
- Current regressions cover nested additions, removals, optional-array creation, and pure reorder. None covers an equal-length element replacement followed by movement inside the same nested primitive array.

**Impact**

Revision history can label a snapshot as wholly user-authored and omit the accepted proposal summary even though the exact AI replacement remains in the saved CV. This violates the same exact-snapshot provenance boundary as the prior Medium array findings.

**Required correction**

Represent an equal-length primitive-array replacement with parent-array contribution semantics that follow the post-AI value across movement while remaining baseline/multiplicity-aware, including inside a stable-ID item. Add a regression for AI element replacement followed by manual prepend/reorder and explicit Save, plus an inverse proving attribution clears when the replacement is removed or restored.

## Prior boundary sanity check

- **Explicit Save/download — pass:** edits remain local until `saveDraft`; duplicate saves share one in-flight promise; newer edits survive an older in-flight save; stale conflicts remain dirty; dirty download requires Save, Discard, or Cancel; clean/Discard download does not implicitly create a revision (`frontend/apps/web-spa/src/lib/cv-store.ts:369-449`; `frontend/apps/web-spa/src/routes/BuilderRoute.tsx:24-107`, `158-170`). Fresh store and UI tests passed.
- **CV-local revisions and restore — pass:** commit and restore validate and normalize the profile/layout pair, lock the owned CV, compare `baseRevision`, update `cv_documents`, and insert the exact paired revision in one transaction (`backend/internal/api/cv_revision.go:202-245`, `631-728`). The current store rejects restore while dirty or saving (`frontend/apps/web-spa/src/lib/cv-store.ts:451-481`). Fresh API tests passed without skips, including CV-local authority, concurrent/stale writers, ownership, normalization/read-back, exact history preservation, and rollback.
- **Layout — pass:** TypeScript and Go require the complete canonical node set, non-empty canonical IDs, unique item IDs/references, valid references, and post-normalization readable state (`frontend/packages/schema/src/cv-layout.ts:17-67`; `frontend/packages/schema/src/cv.ts:53-155`; `backend/internal/api/cv_revision.go:99-168`, `202-245`). Current schema/UI/API tests passed.
- **Shared renderer — pass:** editor, preview, and SSR print continue through the layout-ordered `CVBlockRenderer`; registered fallback fields, activities, current-role text, tags, date ranges, and print-style markup remain present (`frontend/apps/web-spa/src/components/CVBlockRenderer.tsx:53-246`). Current renderer/UI and SSR tests passed.
- **SSR/PDF — pass:** the print handler validates the real `CVEnvelope` snapshot and authoritative outer layout before rendering through the shared resolver (`frontend/apps/web-spa/src/server/print.tsx:26-56`). Fresh SSR tests passed, and two real Playwright runs produced non-empty A4 PDFs; the long CV met the three-page minimum and retained its final `item 6.9` marker.

No regression was found in these explicit Save, revision/restore, layout, renderer, SSR, or PDF boundaries.

## Fresh verification

```text
cd frontend && npx vitest run --project unit apps/web-spa/test/cv-store.test.ts apps/web-spa/test/cv-patch.test.ts
  PASS: 2 files, 32 tests

cd frontend && npm test -- --run
  PASS: 26 files, 209 tests

cd frontend && npm run typecheck
  PASS: core and SPA TypeScript checks

cd frontend && npm --workspace @hr/web-spa run build
  PASS: Vite client build and bundled SSR server

cd backend && go test ./... -count=1
  PASS: all backend packages; cmd/api has no tests

cd backend && go test -v ./internal/api -count=1
  PASS: all API tests; no skips

cd frontend && npm run test:int -- --run apps/web-spa/test/print-e2e.int.test.ts
  PASS: 1 file, 2 real Playwright/PDF tests

cd frontend && npm run db:roundtrip-check
  PASS: 1 valid v2 profile, 0 errors

git diff --check
  PASS before this report was created
```

The full frontend run logs two known non-failing `401 (Unauthorized)` requests from `routing.ui.test.tsx`; they do not affect the finding count.

`npm run lint` still cannot start because `frontend/eslint.config.js:135-137` contains an unmatched extra `{`. Git history shows the syntax defect predates this feature and the file is unchanged across the reviewed fix series, so it is disclosed as a pre-existing tooling limitation rather than counted as a `7c762e3` finding.

## Merge gate

Keep the gate closed until equal-length nested primitive-array replacements retain provenance across supported index movement and the inverse behavior is regression-tested. The two review-4 reproductions and all requested non-provenance boundaries pass on `7c762e3`.

## Round 8 fix verification

Equal-length primitive-array replacements now record parent-array contribution semantics with baseline multiplicity, stable item identity, and nested relative paths. The AI replacement survives manual prepend/reorder within the owning stable-ID item, while restoring or removing the replacement clears provenance.

Added positive and inverse regressions through `applyChatOpsToDraft`, `applyAIDraft`, and `saveDraft` for nested `techStack[0]` `Go → Rust` replacement.

Focused verification passes: 34 store/patch tests and frontend typecheck. Full frontend, Go, PDF, and round-trip checks are run in the final handoff before commit.

Final handoff verification:

```text
cd frontend && npm test -- --run
  PASS: 26 files, 211 tests
cd frontend && npm run typecheck
  PASS: core and SPA TypeScript checks
cd frontend && npm run test:int -- --run apps/web-spa/test/print-e2e.int.test.ts
  PASS: 2 actual Playwright/PDF tests
cd backend && go test ./... -count=1
  PASS: all backend packages
cd frontend && npm run db:roundtrip-check
  PASS: 1 valid v2 profile, 0 errors
git diff --check
  PASS
```
