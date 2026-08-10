# Final merge-gate review: structured flow CV editor

Date: 2026-08-11 (Asia/Ho_Chi_Minh)  
Reviewed HEAD: `9eb331acfb48b90f0fdcae4a0bb3e1d7dfb6cadf` (`fix: close provenance merge-gate edge cases`)

## Verdict

**NOT READY TO MERGE**

The two provenance failures targeted by `9eb331a` are fixed on the actual current HEAD: an optional-field removal no longer crashes and remains AI-attributed through Save, while a manual replacement after an AI empty-string change is saved as user-authored. The previously repaired layout, shared-renderer, real-envelope print, A4 pagination, CV-local revision, restore, and explicit-save boundaries remain green.

One provenance gap remains. Array changes are tracked as whole-array snapshots, so a later manual append drops AI provenance even when the AI-authored element is still present in the exact saved CV.

**Finding count:** 1 unresolved — 1 Medium.

## Scope and method

- Pinned the review to the live `HEAD` above and confirmed the worktree was clean before this report was created.
- Inspected current source and tests directly. Existing report verdicts were not used as evidence.
- Audited `cv-store` change collection/reconciliation and exercised the actual store through valid chat operations for optional removal, empty-string overwrite, and mixed array edits.
- Rechecked the previously repaired layout/schema, renderer, SSR/PDF, revision/restore, and explicit-save boundaries in current source and tests.
- Ran fresh focused and full verification at this HEAD. No application source, test, migration, or database record was edited by this review; this report is the only repository write.

## Targeted `9eb331a` disposition

### Optional `remove`: resolved

- Provenance now records an explicit `exists` bit and represents deletion as `{ path, exists: false }`, avoiding the old `JSON.parse(JSON.stringify(undefined))` crash (`frontend/apps/web-spa/src/lib/cv-store.ts:116-145`).
- Reconciliation checks property ownership and preserves a deletion only while that path remains absent (`frontend/apps/web-spa/src/lib/cv-store.ts:147-163`).
- The checked-in regression applies a valid `remove /sections/intro/availability` through `applyChatOpsToDraft` and `applyAIDraft`, then verifies the optional field is absent and provenance is retained (`frontend/apps/web-spa/test/cv-store.test.ts:241-256`).
- A fresh read-only store probe continued through `saveDraft`; the emitted request had no own `availability` property and contained `source: "ai"` plus `message: "Remove availability"`.

### Empty-string overwrite: resolved

- String-containment reconciliation is disabled when the AI `after` value is empty, so `""` no longer matches every later manual string (`frontend/apps/web-spa/src/lib/cv-store.ts:157-163`).
- The checked-in regression performs AI title to `""`, manual title to `"Independent manual"`, and Save, then verifies a `user` commit with no AI message (`frontend/apps/web-spa/test/cv-store.test.ts:258-270`).

## Finding

### Medium — Surviving AI array contributions are mislabeled as user-authored after a manual edit to the same array

**Evidence**

- `collectChanges` recursively decomposes plain objects only. Any array delta falls through to one change containing the complete post-AI array (`frontend/apps/web-spa/src/lib/cv-store.ts:130-145`).
- `reconcileProvenance` retains arrays only by exact deep equality; its contribution-preserving containment rule applies only to strings (`frontend/apps/web-spa/src/lib/cv-store.ts:157-163`). Therefore any subsequent manual append, removal, or edit in that array discards the entire AI provenance entry even when the AI element survives unchanged.
- This is reachable through the supported proposal contract: adding a highlight, skill, or technology at an array `/-` path is explicitly allowed and applied by the client patch layer (`frontend/apps/web-spa/src/lib/cv-patch.ts:33-45`, `68-118`).
- A fresh probe against the actual store performed: AI `add /sections/experience/0/highlights/-` with `"AI bullet"` -> manual append `"Manual bullet"` -> Save. The exact outgoing snapshot retained both bullets, but the commit body was:

  ```json
  {
    "highlights": ["AI bullet", "Manual bullet"],
    "source": "user",
    "message": null
  }
  ```

- Current mixed-edit coverage exercises a string extension and in-flight versioning, not a surviving array contribution (`frontend/apps/web-spa/test/cv-store.test.ts:191-209`). No checked-in regression covers AI array edit -> manual same-array edit -> Save.

**Impact**

Revision history can label a snapshot as wholly user-authored and omit its AI summary even though accepted AI content remains in that exact revision. This violates the same exact-snapshot provenance contract that the recent fixes are intended to close and affects common highlight, skill, technology-stack, item-order, and section-item edits.

**Required correction**

Track array contributions at stable element/path granularity, or otherwise reconcile whether the specific AI-added/replaced values survive rather than comparing the complete array snapshot. Add a store regression that applies a valid AI array operation, performs a manual edit in the same array, saves, and requires `source: "ai"` with the proposal summary while the AI contribution remains.

## Previously resolved boundary sanity check

- **Layout integrity:** shared schemas require canonical, non-empty identifiers; Go rejects malformed references, normalizes nested item order, and revalidates before persistence (`frontend/packages/schema/src/cv-layout.ts:17-67`; `frontend/packages/schema/src/cv.ts:53-155`; `backend/internal/api/cv_revision.go:99-169`, `202-245`). API tests cover empty IDs/references and commit-to-GET readability.
- **Renderer and print:** editor/preview/SSR print still use the ordered `CVBlockRenderer`; current registered fields, activities, movable Header/Footer, current-role text, tags, and print-style classes are present (`frontend/apps/web-spa/src/components/CVBlockRenderer.tsx:53-246`). SSR validates the real `CVEnvelope` snapshot and authoritative outer layout before rendering (`frontend/apps/web-spa/src/server/print.tsx:26-56`). Fresh real-PDF tests produced A4 output and retained the final marker in a multi-page CV.
- **Revision and restore:** reads and export use `cv_documents.profile_snapshot`; commit/restore compare `baseRevision` under the CV lock, update snapshot plus layout transactionally, and return the inserted revision's exact pair (`backend/internal/api/cv_revision.go:547-572`, `631-745`, `806-885`; `backend/internal/api/server.go:268-315`). Backend concurrency, stale restore, rollback, ownership, and read-back tests passed.
- **Save boundaries:** edits remain local until explicit Save; dirty download requires Save/Discard/Cancel; restore is blocked while dirty or saving; in-flight saves preserve newer edits and provenance IDs (`frontend/apps/web-spa/src/lib/cv-store.ts:243-359`; `frontend/apps/web-spa/src/routes/BuilderRoute.tsx:24-107`, `145-170`). Current store/UI tests passed.

## Fresh verification

```text
cd frontend && npx vitest run --project unit apps/web-spa/test/cv-store.test.ts apps/web-spa/test/cv-patch.test.ts
  PASS: 2 files, 21 tests

cd frontend && npm test -- --run
  PASS: 26 files, 198 tests

cd frontend && npm run typecheck
  PASS: core and SPA TypeScript checks

cd backend && go test ./... -count=1
  PASS: all backend packages; cmd/api has no tests

cd frontend && npm run test:int -- --run apps/web-spa/test/print-e2e.int.test.ts
  PASS: 1 file, 2 actual Playwright/PDF tests

cd frontend && npm run db:roundtrip-check
  PASS: 1 valid v2 profile, 0 errors

git diff --check
  PASS before this report was created
```

The full frontend run still logs the known non-failing `401 (Unauthorized)` request from `routing.ui.test.tsx`; it does not change this verdict or finding count.

## Merge gate

Fix the surviving-array provenance loss and add the missing regression before merge. The two `9eb331a` edge cases and the previously repaired layout/render/print/revision/save boundaries pass at the reviewed HEAD.

## Round 4 fix verification

The remaining array-provenance finding is resolved. Array deltas now record additions and replacements at element/index paths, allowing an AI-added highlight, skill, or technology to remain attributed when a later manual edit appends to the same array. A store regression applies a valid AI highlight `add` through `applyChatOpsToDraft` and `applyAIDraft`, manually appends another highlight, and verifies Save emits `source: ai` with the AI summary and both values present.

Verification:

```text
cd frontend && npm run test:unit -- --run apps/web-spa/test/cv-store.test.ts apps/web-spa/test/cv-patch.test.ts
  PASS: 22 tests
cd frontend && npm run typecheck
  PASS: core and SPA TypeScript checks
```

The final full frontend, print/PDF, Go, and round-trip checks are run in the round-4 handoff before commit.
