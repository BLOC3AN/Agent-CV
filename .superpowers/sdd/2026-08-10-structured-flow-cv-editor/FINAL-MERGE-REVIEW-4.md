# Final merge-gate review 4: structured flow CV editor

Date: 2026-08-11 (Asia/Ho_Chi_Minh)  
Reviewed HEAD: `e3d5ed256d2e3d9ab20bd0dcaa3af07f8fac16f1` (`fix: make array provenance identity aware`)

## Verdict

**NOT READY TO MERGE**

Commit `e3d5ed2` resolves the four concrete failures reported at `959effb`: duplicate primitive-add undo clears attribution, manual restoration of an AI reorder clears attribution, a nested scalar edit follows its stable-ID item through reorder, and re-adding a removed item with the same ID clears removal attribution. The explicit Save, CV-local revision/restore, shared-renderer, SSR print, and real A4 PDF boundaries also remain green on the actual current HEAD.

Two provenance gaps remain in supported proposal and manual-edit flows. Surviving AI array contributions are still lost when the containing array changes shape or when a nested array is resolved through a stale numeric item path. Separately, substring-based string reconciliation can retain AI attribution after the exact baseline value has been restored.

**Finding count:** 2 unresolved — 2 Medium.

## Scope and method

- Pinned the review to the live `HEAD` above and confirmed the worktree was clean before this report was created.
- Inspected the current `cv-store`, patch contract, explicit-Save route, revision/restore transaction code, shared renderer, SSR print handler, and their tests directly. Prior reports were used only to identify cases to re-test; their verdicts were not treated as evidence.
- Ran the four checked-in `e3d5ed2` regressions and exercised additional supported operations through the public `applyChatOpsToDraft` + `useCVStore` workflow, capturing the actual outgoing commit bodies.
- Ran fresh focused and full frontend tests, TypeScript checks, backend/API tests, real Playwright/PDF tests, and the database round-trip check.
- Did not edit application source, tests, migrations, or database records. This report is the only intended repository write.

## Targeted `e3d5ed2` disposition

### Duplicate primitive-add undo: resolved

- Primitive additions now record the pre-AI multiplicity and are retained only while the current count remains above it (`frontend/apps/web-spa/src/lib/cv-store.ts:182-190`, `248-249`).
- The regression appends a duplicate highlight, manually removes the added copy, makes an unrelated manual change, and verifies Save emits `source: "user"` with no AI message (`frontend/apps/web-spa/test/cv-store.test.ts:325-340`).

### Reorder restore: resolved

- A same-multiset reorder is represented explicitly with its post-AI order, and exact restoration no longer survives reconciliation (`frontend/apps/web-spa/src/lib/cv-store.ts:176-180`, `247`).
- The regression changes `['Go', 'React']` to `['React', 'Go']`, manually restores the baseline order, and verifies a user-sourced Save (`frontend/apps/web-spa/test/cv-store.test.ts:342-357`).

### Nested stable-ID item reorder: resolved for the reported scalar case

- Stable-ID object arrays are indexed by ID while changes are collected; nested scalar reconciliation finds the item by ID and resolves the relative field path rather than trusting its old array index (`frontend/apps/web-spa/src/lib/cv-store.ts:148-174`, `251-257`).
- The regression edits the first experience title through a valid AI operation, manually swaps the two experience items, and verifies the surviving AI title is saved as AI-authored on the correct item (`frontend/apps/web-spa/test/cv-store.test.ts:359-374`).

### Same-ID re-add provenance: resolved

- Whole stable-ID item removals carry the item identity; reconciliation clears the removal contribution as soon as that ID exists again, regardless of changed fields (`frontend/apps/web-spa/src/lib/cv-store.ts:171-173`, `237-242`).
- The regression removes `exp-1`, manually re-adds `exp-1` with different content, and verifies Save emits `source: "user"` (`frontend/apps/web-spa/test/cv-store.test.ts:376-390`).

## Findings

### Medium — Surviving nested-array and reorder contributions can still be saved as user-authored

**Evidence**

- Reorders are reconciled only when the current array has exactly the recorded length and every element remains at the recorded index (`frontend/apps/web-spa/src/lib/cv-store.ts:247`). A manual append or prepend therefore drops the reorder contribution even when the relative AI-authored order survives unchanged.
- Stable-ID metadata is consulted only after `reconcileProvenance` first resolves `arrayParentPath`, which still contains the item's numeric index at AI-application time (`frontend/apps/web-spa/src/lib/cv-store.ts:233-245`). If a stable-ID item moves onto an index where the nested optional array is absent, or prior items are removed and the old index disappears, reconciliation returns false before looking up the stable item ID.
- When AI creates an optional array property from `undefined`, `collectChanges` does not enter its array-to-array logic and records the complete array as one field value (`frontend/apps/web-spa/src/lib/cv-store.ts:143-145`, `206-218`). A later manual append changes that whole value and drops attribution even though the AI element remains.
- All states are reachable through the supported patch contract: whole registered item fields and individual `highlights`, `skills`, and `techStack` elements may be added/replaced, and manual item order is mutable (`frontend/apps/web-spa/src/lib/cv-patch.ts:21-55`).
- Fresh public-store probes against the actual current source produced these outgoing commit classifications:

  ```json
  {
    "aiReorderThenManualAppend": {
      "savedArray": ["React", "Go", "Vue"],
      "source": "user"
    },
    "aiCreatesOptionalArrayThenManualAppend": {
      "savedArray": ["Go", "React"],
      "source": "user"
    },
    "aiNestedArrayAddThenStableIDItemReorder": {
      "survivingItem": { "id": "exp-1", "techStack": ["Go"] },
      "source": "user"
    },
    "aiNestedArrayAddThenEarlierItemRemoval": {
      "survivingItem": { "id": "exp-2", "highlights": ["AI bullet"] },
      "source": "user"
    }
  }
  ```

- The new nested-item regression covers a required scalar field and a same-length swap (`frontend/apps/web-spa/test/cv-store.test.ts:359-374`). It does not cover nested arrays, optional array creation, or an item shift that invalidates the old numeric path. The reorder regression covers only complete restoration, not a surviving reorder plus a manual addition (`342-357`).

**Impact**

Revision history can label a snapshot as wholly user-authored and omit the proposal summary while exact AI-added values or AI-authored ordering remain in that saved snapshot. This violates the same exact-snapshot provenance contract as the earlier array findings.

**Required correction**

Resolve stable-ID items before checking their nested array path, decompose newly created optional arrays into element contributions, and reconcile ordering as a surviving relative-order contribution rather than requiring whole-array equality. Add inverse regressions for nested arrays across stable-ID movement and for a surviving AI reorder followed by a manual append/prepend.

### Medium — Restoring a baseline string can remain falsely AI-attributed when it contains the AI result

**Evidence**

- String reconciliation retains a change whenever the current string contains the AI `after` string (`frontend/apps/web-spa/src/lib/cv-store.ts:259-266`). It stores no baseline string or baseline occurrence information, so it cannot distinguish a manual extension of AI text from restoration of a pre-AI value that already contained that text.
- Intro `summary` is a supported AI-editable path (`frontend/apps/web-spa/src/lib/cv-patch.ts:21`, `36-37`).
- A fresh public-store probe performed: baseline summary `"Senior Engineer"` -> valid AI replace with `"Engineer"` -> manual restore to `"Senior Engineer"` plus an unrelated manual title edit -> Save. The exact AI replacement was undone, but the outgoing commit was:

  ```json
  {
    "summary": "Senior Engineer",
    "source": "ai",
    "message": "baseline substring restore"
  }
  ```

- Existing coverage proves the positive manual-extension case and an exact revert where the restored string does not contain the AI value (`frontend/apps/web-spa/test/cv-store.test.ts:191-209`, `225-238`). It does not cover a baseline that contains the post-AI substring.

**Impact**

Revision history can claim AI authorship and retain an AI proposal summary after the user has completely undone that proposal. This is the false-retention side of the same exact-snapshot audit contract.

**Required correction**

Make string reconciliation baseline-aware, preserving only the textual contribution introduced by AI rather than any occurrence of the complete post-AI string. Add a regression for a baseline-containing substring restored before an unrelated manual Save.

## Previously repaired boundary sanity check

- **Explicit Save/download — pass:** draft updates remain local; `saveDraft` snapshots and commits only on explicit invocation, preserves newer in-flight edits, and advances the optimistic base revision from the confirmed response (`frontend/apps/web-spa/src/lib/cv-store.ts:347-358`, `387-428`). Dirty download still requires Save, Discard, or Cancel, while clean download opens print without creating a revision (`frontend/apps/web-spa/src/routes/BuilderRoute.tsx:44-63`, `158-170`).
- **CV-local revisions and restore — pass:** commit and restore validate/normalize the profile-layout pair, lock the owned CV row, compare `baseRevision`, update `cv_documents`, and insert the exact paired revision in one transaction (`backend/internal/api/cv_revision.go:202-245`, `631-745`). Dirty or in-flight restore is rejected by the store before the request (`frontend/apps/web-spa/src/lib/cv-store.ts:431-463`). Fresh API tests passed without skips, including divergence, concurrent writer, stale restore, ownership, normalization/read-back, exact history preservation, and rollback cases.
- **Renderer and print — pass:** the SSR handler validates the real `CVEnvelope` profile snapshot and authoritative outer layout, then renders through `CVBlockRenderer` (`frontend/apps/web-spa/src/server/print.tsx:26-56`). The shared renderer remains layout-ordered and carries registered fields and print-style markup. Fresh real Playwright generation produced non-empty A4 output and a multi-page PDF retaining its final content marker.
- **Layout and AI patch boundaries — pass:** current TypeScript and Go validation require canonical complete layouts, non-empty/unique IDs, valid item references, normalized item order, and strict post-patch documents (`frontend/packages/schema/src/cv-layout.ts:17-67`; `frontend/packages/schema/src/cv.ts:53-199`; `backend/internal/api/cv_revision.go:99-168`, `202-295`; `frontend/apps/web-spa/src/lib/cv-patch.ts:33-118`).

No new regression was found in explicit Save, revision/restore atomicity, shared rendering, SSR envelope handling, or real PDF pagination.

## Fresh verification

```text
cd frontend && npx vitest run --project unit apps/web-spa/test/cv-store.test.ts apps/web-spa/test/cv-patch.test.ts
  PASS: 2 files, 27 tests

cd frontend && npm test -- --run
  PASS: 26 files, 204 tests

cd frontend && npm run typecheck
  PASS: core and SPA TypeScript checks

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

The database check was read-only. The invalid record mentioned in the prior handoff was not used to excuse any code result and was not mutated; it was not reproduced by the fresh round-trip command in the current environment.

The full frontend run still logs the known non-failing `401 (Unauthorized)` request from `routing.ui.test.tsx`; it is not counted as a finding.

`npm run lint` is presently unable to start because `frontend/eslint.config.js:135-137` contains an unmatched extra `{`. Git blame and historical reads show that syntax defect predates the structured-flow feature and is unchanged at `959effb` and `e3d5ed2`; it is disclosed as a pre-existing tooling limitation, not counted as an `e3d5ed2` feature regression.

## Merge gate

Keep the gate closed until both exact-snapshot provenance defects are corrected and covered by inverse regressions. The four cases specifically targeted by `e3d5ed2` and the requested explicit Save/revision/restore/print boundaries pass on the reviewed HEAD.

## Round 7 fix verification

Nested and optional arrays now decompose into element contributions even when created from an absent property. Stable item IDs resolve nested arrays before parent-path lookup, and reorder contributions use relative-order subsequence semantics so a manual append/prepend preserves AI ordering while restoring the baseline order clears it. String contributions now retain the baseline value and only accept extension semantics when the current value differs from that baseline, so a baseline-containing substring restore is correctly user-authored.

Added regressions for the four nested/array probes and the baseline-aware string inverse:

- AI reorder followed by manual append;
- AI-created optional array followed by manual append;
- nested AI array add followed by stable-ID item reorder;
- nested AI array add followed by removal of an earlier item;
- baseline `Senior Engineer` → AI `Engineer` → manual baseline restore plus unrelated edit.

Focused verification passes: 32 provenance/patch tests and frontend typecheck. Full frontend, Go, PDF, and round-trip checks are run in the final handoff before commit.

Final handoff verification:

```text
cd frontend && npm test -- --run
  PASS: 26 files, 209 tests
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
