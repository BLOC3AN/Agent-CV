# Final merge-gate review: actual current HEAD

Date: 2026-08-11 (Asia/Ho_Chi_Minh)
Reviewed HEAD: `8cb2c31d517db07ec0d79d28e46f3b233291aa02` (`fix: preserve nested replacement provenance`)

## Verdict

**NOT READY TO MERGE**

The specific equal-length nested primitive-array replacement failure reported at `7c762e3` is fixed on the actual current HEAD. An AI replacement now follows its post-AI value across a manual prepend, including when the owning stable-ID item also moves, and provenance clears when that replacement is removed or the baseline array is restored. The prior explicit-Save, CV-local revision/restore, layout, shared-renderer, SSR, real-PDF, patch-validation, and earlier provenance boundaries remain green.

One supported provenance gap remains. When one whole primitive-array proposal combines a reorder with additions, removals, or replacements, collection records only the value delta and drops the order delta. If the user later undoes the value portion while preserving the AI-authored order, Save incorrectly emits a user revision.

**Finding count:** 1 unresolved — 1 Medium.

## Scope and method

- Pinned the review to the live HEAD above and confirmed the worktree was clean before creating this report.
- Inspected the complete `7c762e3..8cb2c31` source/test diff and the current provenance collector/reconciler directly.
- Ran the checked-in replacement regressions and exercised positive, inverse, stable-ID movement, and mixed-array cases through the public `applyChatOpsToDraft` + `useCVStore` + `saveDraft` workflow in a temporary isolated copy of HEAD.
- Re-ran the full frontend suite, TypeScript checks, production SPA/SSR build, full and verbose backend/API tests, real Playwright/PDF tests, and database round-trip validation.
- Did not edit application source, tests, migrations, or database records. This report is the only workspace write.

## Targeted `8cb2c31` disposition

### Equal-length nested primitive-array replacement: resolved for the reported operation

- Equal-length primitive arrays with changed multisets now emit `replace` contributions carrying the parent-array path, post-AI value, baseline multiplicity, stable item identity, and nested relative path (`frontend/apps/web-spa/src/lib/cv-store.ts:185-194`).
- Reconciliation resolves the stable-ID item first, then retains `replace` exactly while the post-AI value count exceeds its baseline count (`frontend/apps/web-spa/src/lib/cv-store.ts:247-275`). This removes dependence on the old nested numeric index.
- The checked-in positive regression performs `techStack[0]` `Go -> Rust`, manually prepends `Manual`, and requires an AI-sourced Save. The inverse restores `['Go', 'React']` and requires a user-sourced Save (`frontend/apps/web-spa/test/cv-store.test.ts:477-508`).
- Fresh public-store probes additionally passed both of these boundaries:
  - replace `Go -> Rust`, move the owning `exp-1` item, prepend within its `techStack`, then Save: `source: "ai"` with the proposal summary;
  - replace `Go -> Rust`, manually remove `Rust`, make an unrelated edit, then Save: `source: "user"` with no AI summary.

## Finding

### Medium — Mixed primitive-array edits discard surviving AI reorder provenance

**Evidence**

- Whole-field replacement is a supported proposal operation for `highlights`, `skills`, and `techStack` (`frontend/apps/web-spa/src/lib/cv-patch.ts:38-45`).
- `collectChanges` emits a reorder contribution only when the before/after multisets are identical. For an equal-length array with any value replacement, it immediately returns only baseline-counted `replace` entries (`frontend/apps/web-spa/src/lib/cv-store.ts:185-195`). The growth and shrink branches likewise record only additions or removals (`frontend/apps/web-spa/src/lib/cv-store.ts:196-215`). None records ordering that changed alongside the value delta.
- `reconcileProvenance` can preserve relative order for an explicit `reorder` entry, but it cannot recover an order contribution that collection omitted; once the recorded added/replaced value is undone, no provenance remains (`frontend/apps/web-spa/src/lib/cv-store.ts:264-275`).
- A fresh public-store probe against current HEAD performed:

  ```text
  baseline: ["Go", "React", "Vue"]
  AI whole-array replace: ["React", "Go", "Rust"]
  manual restore/append: ["React", "Go", "Vue", "Manual"]
  Save: source="user", message=undefined
  ```

  The AI-added `Rust` was undone, but the AI-authored `React`-before-`Go` order remained in the exact saved array. A second probe reproduced the same loss for a mixed reorder-plus-append proposal after the appended value was manually removed.
- Current tests separately cover a pure reorder and an individual element replacement. They do not cover one proposal that combines reorder and value/shape changes in the same primitive array (`frontend/apps/web-spa/test/cv-store.test.ts:342-357`, `393-408`, `477-508`).

**Impact**

Revision history can label a saved snapshot as wholly user-authored and omit its AI proposal summary while an AI-authored ordering contribution remains. This is the same exact-snapshot audit-boundary failure as the prior Medium provenance findings.

**Required correction**

Collect primitive-array order and value/multiplicity deltas as independent contributions when both occur in one proposal, then reconcile the order contribution with the existing relative-order semantics. Add regressions for an equal-length mixed reorder/replacement whose replacement is manually restored and a mixed reorder/add whose addition is manually removed.

## Prior boundary verification

- **Explicit Save/download:** local edits, duplicate/in-flight Save behavior, stale conflicts, provenance across in-flight saves, Save/Discard/Cancel download decisions, and dirty restore guards passed in the current store/UI suites.
- **CV-local revisions/restore:** fresh API tests passed without skips for CV-local authority, concurrent/stale writers, exact revision pairing, ownership, legacy normalization, canonical read-back, history preservation, and rollback.
- **Layout, shared renderer, and field contract:** canonical IDs/references, item ordering, legacy recovery, visibility, activities, registered fields, fallback placement, and print-style behavior passed in current schema/UI/SSR tests.
- **SSR/PDF:** the real-envelope print handler and shared renderer passed unit tests; two fresh Playwright runs produced non-empty A4 PDFs, including the multi-page final-marker boundary.
- **AI patch safety:** current client/server tests passed strict schema validation and unknown, forbidden, malformed, and destructive path rejection.
- **Earlier provenance cases:** optional-field removal, empty-string overwrite, mixed/in-flight edits, primitive additions/removals, duplicate multiplicity, pure reorder restoration/survival, stable-ID movement/re-add, optional-array creation, nested additions, and baseline-aware strings all passed.

## Fresh verification

```text
cd frontend && npx vitest run --project unit apps/web-spa/test/cv-store.test.ts apps/web-spa/test/cv-patch.test.ts
  PASS: 2 files, 34 tests

cd frontend && npm test -- --run
  PASS: 26 files, 211 tests

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

The full frontend run logged the known non-failing `401 (Unauthorized)` request from `routing.ui.test.tsx`; it did not affect the suite or finding count.

`npm run lint` still cannot parse `frontend/eslint.config.js:135-137` because of the pre-existing unmatched `{`. The file is unchanged from `ecdc190` through current HEAD, so this remains a disclosed tooling limitation rather than a finding against `8cb2c31`.

The commit-range whitespace check flags the two-space Markdown line break in the newly committed prior review artifact. It does not affect application behavior and is not counted as a merge-gate finding.

## Merge gate

Keep the gate closed until mixed primitive-array changes retain surviving ordering provenance and the two inverse regressions above are checked in. The targeted equal-length nested element replacement and all prior non-mixed boundaries pass on `8cb2c31`.

## Round 9 fix verification

Primitive-array collection now emits order and value/multiplicity contributions independently. Mixed reorder-plus-replacement and reorder-plus-add proposals therefore retain their relative AI order even after the replacement/addition is manually undone, while each value contribution independently clears when removed.

Added inverse regressions through `applyChatOpsToDraft`, `applyAIDraft`, and `saveDraft` for:

- mixed reorder + replacement followed by replacement restoration;
- mixed reorder + add followed by addition removal.

Focused verification passes: 36 store/patch tests and frontend typecheck. Full frontend, Go, PDF, and round-trip checks are run in the final handoff before commit.

Final handoff verification:

```text
cd frontend && npm test -- --run
  PASS: 26 files, 213 tests
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
