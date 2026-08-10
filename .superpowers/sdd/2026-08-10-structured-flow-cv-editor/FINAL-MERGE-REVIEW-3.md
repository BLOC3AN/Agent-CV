# Final merge-gate review 3: structured flow CV editor

Date: 2026-08-11 (Asia/Ho_Chi_Minh)
Reviewed HEAD: `959effb09c65fc06e115ad0897fb4b6e3684d099` (`fix: reconcile shifted array provenance`)

## Verdict

**NOT READY TO MERGE**

Commit `959effb` fixes the narrow unique-primitive cases targeted by the prior report: an AI-added highlight remains attributed after a manual prepend/reorder, a unique AI removal remains attributed through a different same-array edit, and attribution clears when that exact removed value is re-added. All earlier Critical/High layout, renderer, print/PDF, revision, restore, AI-patch, and explicit-save boundaries also remain green on the actual current HEAD.

The array reconciliation is still not safe for the complete supported array contract. It matches additions and removals by deep value rather than baseline multiplicity or stable item identity, and it treats same-length changes as values that may occur anywhere in the parent array. This causes both false retention and false loss for duplicate values, reverted reorders, and stable-ID item reorder/re-add flows.

**Finding count:** 1 unresolved — 1 Medium.

## Scope and method

- Pinned the review to the live `HEAD` above and confirmed the worktree was clean before creating this report.
- Inspected the complete `dce4d4a..959effb` application/test diff and the current provenance implementation directly.
- Ran the checked-in provenance regressions and loaded/transpiled the exact current `collectChanges`, `reconcileProvenance`, and `deepEqual` functions for positive and inverse boundary probes.
- Rechecked all earlier merge-gate boundaries with fresh frontend, TypeScript, backend/API/database, real Playwright/PDF, and v2 round-trip verification.
- Did not edit application source, tests, migrations, or database records. This report is the only repository write.

## Targeted `959effb` disposition

### Unique primitive addition across prepend/reorder: resolved

- A growing array is multiset-diffed and each newly added value is recorded with its parent-array path (`frontend/apps/web-spa/src/lib/cv-store.ts:138-152`).
- Reconciliation finds an unchanged AI-added value anywhere in that parent array, so numeric index movement no longer drops it (`frontend/apps/web-spa/src/lib/cv-store.ts:192-200`).
- The checked-in regression changes `['Existing', 'AI bullet']` to `['AI bullet', 'Manual first', 'Existing']` and verifies an AI-sourced Save (`frontend/apps/web-spa/test/cv-store.test.ts:272-298`).
- A fresh probe against the exact current functions retained one provenance entry after that prepend/reorder and retained zero after the unique AI value was subsequently removed.

### Unique removal across a same-array edit: resolved

- A shrinking array records the removed value and its pre-AI multiplicity; reconciliation retains it while the current multiplicity remains below that baseline (`frontend/apps/web-spa/src/lib/cv-store.ts:153-161`, `194-200`).
- The checked-in regression removes `AI remove me`, appends `Manual follow-up`, and verifies an AI-sourced Save (`frontend/apps/web-spa/test/cv-store.test.ts:300-323`).
- A fresh inverse probe retained the removal after the unrelated same-array edit and cleared it after the exact removed value was re-added.

## Finding

### Medium — Value-only array matching still falsely retains and drops AI provenance in supported edits

**Evidence**

- AI additions are retained with `parent.value.some(deepEqual(arrayValue))`, but the change does not record the pre-AI count (`frontend/apps/web-spa/src/lib/cv-store.ts:143-152`, `194-198`). If an AI appends a duplicate highlight and the user removes that added copy, the baseline copy still satisfies `.some`, so the stale AI provenance survives.
- Same-length array changes recurse by index and carry only the parent-array path (`frontend/apps/web-spa/src/lib/cv-store.ts:163-179`). Reconciliation then accepts the changed scalar if it occurs anywhere in the parent array (`frontend/apps/web-spa/src/lib/cv-store.ts:201-205`). An AI reorder of `itemOrder: ['a', 'b']` to `['b', 'a']` therefore remains attributed after the user restores `['a', 'b']`, because both post-AI values still occur somewhere. A later unrelated manual edit is consequently saved as AI-authored.
- For arrays of stable-ID objects, the same fallback compares each parent object to a changed nested scalar. It cannot follow an AI-edited item field after the user reorders the items. The AI value survives in the exact draft, but provenance disappears and Save becomes user-authored.
- Whole-item removals use deep equality of the entire removed object rather than its stable `id`. Re-adding the same item ID with manually changed fields does not match the old object, so removal provenance is falsely retained even though that item identity is present again.
- These are reachable production states. The AI patch allowlist permits whole section-item add/replace/remove, nested field edits, highlight/skill/tech-stack array edits, and `itemOrder` changes (`frontend/apps/web-spa/src/lib/cv-patch.ts:33-55`); CV items have required stable IDs, while primitive arrays do not prohibit duplicates (`frontend/packages/schema/src/cv.ts:53-155`).
- The two new regressions cover only the positive unique-value cases and do not exercise an undone duplicate addition, a reverted reorder, a nested field surviving item reorder, or a same-ID item re-add (`frontend/apps/web-spa/test/cv-store.test.ts:272-323`).
- Fresh probes loading the exact current functions returned:

  ```json
  {
    "nestedEditThenItemReorder": { "recordedChanges": 1, "retainedEntries": 0 },
    "duplicateAppendThenManualUndo": { "recordedChanges": 1, "retainedEntries": 1 },
    "itemOrderAIReorderThenManualRestore": { "recordedChanges": 2, "retainedEntries": 1 },
    "removedItemReaddedWithSameID": { "recordedChanges": 1, "retainedEntries": 1 }
  }
  ```

  Expected retained-entry counts are respectively `1`, `0`, `0`, and `0`.

**Impact**

Revision history can still omit AI attribution while an AI-edited value survives after item reordering, or claim AI attribution after the user has undone an AI duplicate/reorder/removal contribution. No CV content is lost, but `source` and proposal summaries can be wrong for the exact saved revision. This is the same audit-boundary severity as the prior array-provenance findings.

**Required correction**

Use contribution semantics appropriate to each array shape: track baseline multiplicity for primitive additions, track ordering deltas independently of value presence, and use stable item IDs plus nested paths for object-array edits/removals. Add inverse regressions proving provenance clears after duplicate-add undo, reorder restoration, and same-ID re-add, while a nested AI field remains attributed after item reorder.

## Earlier boundary sanity check

- **Production SSR/PDF and A4 pagination — pass:** the real-envelope print path and shared renderer produced two valid PDFs, including the multi-page final-marker assertion.
- **CV-local revision authority and concurrency — pass:** fresh backend tests passed for CV-local GET/export, legacy PATCH bypass prevention, stale commit/restore rejection, concurrent writers, exact revision pairing, transaction rollback, ownership, and history restore.
- **Explicit Save/download and dirty restore — pass:** the full store/UI suite passed local-draft, Save/Discard/Cancel download, in-flight Save, conflict, and dirty/saving restore boundaries.
- **Renderer/catalog/layout integrity — pass:** current unit/UI/API tests passed canonical IDs and references, normalization/read-back, activities and registered fields, Header/Footer order/visibility, print-style behavior, and malformed-layout rejection.
- **AI schema/path boundaries — pass:** current client/server tests passed unknown/destructive path rejection, strict post-patch validation, optional-field removal, empty-string overwrite, and proposal settlement without persisted mutation.

No new Critical or High finding was identified outside provenance.

## Fresh verification

```text
cd frontend && npx vitest run --project unit apps/web-spa/test/cv-store.test.ts apps/web-spa/test/cv-patch.test.ts
  PASS: 2 files, 23 tests

cd frontend && npm test -- --run
  PASS: 26 files, 200 tests

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

The full frontend suite still logs the known non-failing `401 (Unauthorized)` requests from `routing.ui.test.tsx`; they are not counted as findings.

## Merge gate

Keep the gate closed until array provenance is baseline- and identity-aware for the supported duplicate, reorder, and stable-ID cases, with inverse regressions that rule out false retention. The narrow unique-value scenarios fixed by `959effb` and every earlier Critical/High boundary pass on the reviewed HEAD.

## Round 6 fix verification

Array provenance is now baseline- and identity-aware. Primitive additions/removals carry baseline multiplicity, reorder changes carry the expected order, and object-array changes use stable item IDs with nested relative field paths. This preserves nested AI fields after stable-ID item reorder while clearing duplicate-add undo, restored reorder, and same-ID item re-add cases.

Added inverse regressions for all four audit cases:

- duplicate primitive AI append then undo;
- AI primitive reorder then manual restore;
- nested AI item-field edit then stable-ID item reorder;
- AI item removal then same-ID re-add with changed fields.

Round-6 focused verification passes: 27 provenance/patch tests and frontend typecheck. Full frontend, Go, PDF, and round-trip checks are run in the final handoff before commit.

Final handoff verification:

```text
cd frontend && npm test -- --run
  PASS: 26 files, 204 tests
cd frontend && npm run typecheck
  PASS: core and SPA TypeScript checks
cd frontend && npm run test:int -- --run apps/web-spa/test/print-e2e.int.test.ts
  PASS: 2 actual Playwright/PDF tests
cd backend && go test ./... -count=1
  PASS: all backend packages
git diff --check
  PASS
```

`npm run db:roundtrip-check` reported one unrelated pre-existing database record (`19ac7762-6ce9-427c-94a1-d2c313703dfc`) with an empty layout and therefore 10 missing canonical nodes. No database state was changed; the source and test changes in this pass do not touch migrations or persisted records.
