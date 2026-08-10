# Final merge-gate review 2: structured flow CV editor

Date: 2026-08-11 (Asia/Ho_Chi_Minh)  
Reviewed HEAD: `dce4d4ad643b811abc9ae00d60f93780a73d9665` (`fix: preserve AI provenance for array edits`)

## Verdict

**NOT READY TO MERGE**

The checked-in tail-append case introduced by `dce4d4a` now preserves AI provenance, and every earlier Critical/High boundary remains green on the actual current HEAD. The prior surviving-array provenance finding is only partially fixed, however: provenance is recorded by array index, so a later manual prepend or reorder drops attribution even though the exact AI-authored value still survives in the saved CV. Array removals also remain whole-array snapshots and lose attribution after a later edit to that array.

**Finding count:** 1 unresolved — 1 Medium.

## Scope and method

- Pinned the review to the live `HEAD` above and confirmed the worktree was clean before this report was created.
- Inspected the current implementation and regression rather than relying on the appended fix note in the prior report.
- Reproduced the residual array behavior from the exact `collectChanges` and `reconcileProvenance` functions loaded from current `cv-store.ts`.
- Rechecked all Critical/High boundaries from the earlier whole-branch, re-review, and merge-gate reports in current source and tests.
- Ran fresh frontend, backend, real-PDF, type, and database verification. No application source, test, migration, or database record was edited; this report is the only repository write.

## Finding

### Medium — Array provenance is still positional and disappears when a surviving AI value shifts index

**Evidence**

- `collectChanges` now decomposes non-shrinking arrays recursively by numeric index (`frontend/apps/web-spa/src/lib/cv-store.ts:130-137`). This fixes AI tail append followed by manual tail append because the AI element stays at the recorded index.
- `reconcileProvenance` resolves only the recorded path and retains the contribution only when the value at that exact path still matches (`frontend/apps/web-spa/src/lib/cv-store.ts:153-169`). It does not follow a surviving array value when a manual insertion or reorder moves it.
- The manual highlights editor replaces the array from freely ordered textarea lines, so prepending/reordering is a supported manual edit, not an unreachable state (`frontend/apps/web-spa/src/lib/cv-store.ts:64-80`). Layout `itemOrder`, skills, and technology arrays have the same positional exposure.
- The new regression covers only `['Existing', 'AI bullet']` becoming `['Existing', 'AI bullet', 'Manual bullet']`, where the AI value remains at index 1 (`frontend/apps/web-spa/test/cv-store.test.ts:272-298`).
- A fresh probe loading and transpiling the exact current provenance functions produced:

  ```json
  {
    "recordedChange": { "path": "/cv/sections/experience/0/highlights/1", "after": "AI bullet" },
    "manualTailAppend": { "aiStillPresent": true, "retainedEntries": 1 },
    "manualPrepend": { "aiStillPresent": true, "retainedEntries": 0 }
  }
  ```

  The prepend snapshot was `['Manual first', 'Existing', 'AI bullet']`: the accepted AI bullet remained byte-for-byte present but Save would derive `source: "user"` and omit the AI summary because provenance was empty.
- Array shrink is still explicitly stored as one whole-array snapshot (`frontend/apps/web-spa/src/lib/cv-store.ts:132-134`). A second probe performed AI removal followed by a manual tail append; the removal remained effective, but retained provenance entries fell to zero.

**Impact**

Revision history can still label a saved snapshot as wholly user-authored and omit its AI summary while accepted AI array content remains in that exact revision. This is the same exact-snapshot audit contract as the prior surviving-array finding; `dce4d4a` closes one ordering pattern, not the boundary.

**Required correction**

Track array contributions with stable element identity/value semantics, or reconcile surviving AI values across index movement and model surviving removals independently of a whole-array equality check. Add regressions for AI append followed by manual prepend/reorder and for AI array removal followed by another manual edit to the same array.

## Earlier Critical/High boundary sanity check

- **Production SSR/PDF envelope — pass:** the print handler validates and unwraps `body.cv.profileSnapshot`, uses the authoritative outer layout, and renders through the shared resolver (`frontend/apps/web-spa/src/server/print.tsx:26-56`). Fresh Playwright generation produced two valid A4 PDFs, including a multi-page document retaining its final marker.
- **CV-local snapshot authority — pass:** current reads and API export use `cv_documents.profile_snapshot`; the legacy PATCH path cannot bypass an existing revision history (`backend/internal/api/cv_revision.go:547-572`; `backend/internal/api/server.go:268-315`, `430-465`). The divergence and bypass database tests passed without skips.
- **Stale/concurrent revision safety and exact response pairing — pass:** commit/restore compare `baseRevision` under the CV lock and construct the response from the inserted revision snapshot (`backend/internal/api/cv_revision.go:631-745`, `806-885`). Concurrent-writer, stale-restore, atomic rollback, ownership, and exact-pair tests passed.
- **Explicit Save/download — pass:** edits remain local; dirty download requires Save, Discard, or Cancel, and clean export does not implicitly create a revision (`frontend/apps/web-spa/src/routes/BuilderRoute.tsx:24-107`, `145-170`). Current store/UI regressions passed.
- **Dirty restore — pass:** both the UI and store reject restore while dirty or saving before issuing the request (`frontend/apps/web-spa/src/components/VersionHistoryPanel.tsx:181-203`; `frontend/apps/web-spa/src/lib/cv-store.ts:333-365`).
- **Renderer/registered fields/print — pass:** activities, supported catalog placements, current-role text, contact fallbacks, tags, date ranges, Header/Footer ordering, and print styles flow through `CVBlockRenderer` (`frontend/apps/web-spa/src/components/CVBlockRenderer.tsx:53-246`). SSR and actual-PDF assertions passed.
- **Layout integrity/readability — pass:** TypeScript and Go enforce the complete canonical node set, non-empty identifiers, unique references, valid item references, normalization, and post-normalization validation (`frontend/packages/schema/src/cv-layout.ts:17-67`; `backend/internal/api/cv_revision.go:99-169`, `202-295`). Reject/read-back database tests passed.
- **AI path/schema enforcement — pass:** client and server allowlists reject unknown fields, prohibited design properties, destructive node removal, and malformed post-patch documents; parsed strict schema output is used (`frontend/apps/web-spa/src/lib/cv-patch.ts:21-118`; `backend/internal/api/server.go:1958-2074`). The optional-field `remove` High finding also remains fixed: absence is represented explicitly and no longer JSON-cloned as `undefined` (`frontend/apps/web-spa/src/lib/cv-store.ts:125-169`).

## Fresh verification

```text
cd frontend && npm test -- --run
  PASS: 26 files, 199 tests

cd frontend && npm run typecheck
  PASS: core and SPA TypeScript checks

cd backend && go test ./... -count=1
  PASS: all backend packages; cmd/api has no tests

cd backend && go test -v ./internal/api -count=1
  PASS: all API tests, including database-backed boundary tests; no skips

cd frontend && npm run test:int -- --run apps/web-spa/test/print-e2e.int.test.ts
  PASS: 1 file, 2 actual Playwright/PDF tests

cd frontend && npm run db:roundtrip-check
  PASS: 1 valid v2 profile, 0 errors

git diff --check
  PASS before this report was created
```

The full frontend suite still logs the known non-failing `401 (Unauthorized)` request from `routing.ui.test.tsx`; it is not counted as a finding.

## Merge gate

Keep the gate closed until provenance survives index movement and same-array edits beyond the tail-append case. All earlier Critical/High boundaries pass on `dce4d4a`; the one remaining blocker is the Medium exact-snapshot provenance finding above.

## Round 5 fix verification

The positional array-provenance gap is resolved. Array additions and replacements now carry their parent-array path and reconcile surviving values independently of numeric index, so prepend/reorder edits retain an AI contribution only while that value remains. Array removals track the removed value and baseline multiplicity; later same-array edits preserve AI provenance while the removed value stays absent, but re-adding it does not falsely retain the removal contribution.

Regressions cover AI append followed by a manual prepend/reorder and AI removal followed by a same-array manual edit and Save.

Final verification:

```text
cd frontend && npm test -- --run
  PASS: full frontend suite
cd frontend && npm run typecheck
  PASS: core and SPA TypeScript checks
cd frontend && npm run test:int -- --run apps/web-spa/test/print-e2e.int.test.ts
  PASS: actual Playwright/PDF tests
cd backend && go test ./... -count=1
  PASS: all backend packages
cd frontend && npm run db:roundtrip-check
  PASS: v2 round-trip validation
```
