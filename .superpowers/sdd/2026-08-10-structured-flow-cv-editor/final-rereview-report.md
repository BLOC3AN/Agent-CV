# Final re-review: fix commit `f48458c`

## Verdict

**NOT READY TO MERGE**

Commit `f48458ca3dd29d9764836beba165e7b88949abf8` resolves 8 of the 11 findings from the previous whole-branch review. The production `CVEnvelope` print boundary, CV-local snapshot authority, optimistic concurrency/exact response pairing, explicit dirty-download decision, dirty-restore guard, AI path allowlist, layout-owned visibility, and typed catalog storage are materially corrected and freshly verified.

Three prior findings remain incomplete. Two are High because valid/accepted state can still disappear in rendering or produce a persisted layout that the next read rejects. One is Medium because revision provenance can still claim AI authorship after the AI change has been manually removed from the draft.

**Finding count:** 3 unresolved — 2 High, 1 Medium. 8 of 11 prior findings are resolved.

## Scope and method

- Audited only current `HEAD`, confirmed as `f48458ca3dd29d9764836beba165e7b88949abf8` (`fix: harden CV revision and print boundaries`). The parent is `ecdc190611911a1e6d0830729448dd1166d31d6b`.
- Used the prior report at `.superpowers/sdd/2026-08-10-structured-flow-cv-editor/final-review-report.md` as the 11-item checklist and checked the implementation against `backend/docs/superpowers/plans/2026-08-10-structured-flow-cv-editor.md`, especially its Global Constraints.
- Inspected the production Go API, SPA store/routes, shared renderer, print server, Zod schema, AI patch boundaries, and the tests changed by `f48458c`.
- Ran fresh backend, frontend, type, and actual PDF verification. Also ran read-only boundary probes for allowed summary-field rendering, full stored-field rendering, empty canonical identifiers, and provenance after a manual revert.
- Did not edit application code or database state. This report is the only file written.

## Blocking findings

### High

#### 1. Prior Finding 7 remains: the canonical schema accepts empty IDs, and commit normalization can manufacture a layout that the backend itself rejects

**Evidence**

- The shared layout schema uses `z.string()` for `itemOrder` entries and checks only duplicates; it does not require a non-empty identifier (`frontend/packages/schema/src/cv-layout.ts:25-26`, `47-65`).
- The shared CV schema likewise uses plain `z.string()` for every item `id`, and its array refinement checks duplicates but not empty IDs (`frontend/packages/schema/src/cv.ts:53-65`, `67-80`, `82-144`).
- A direct shared-schema probe at `HEAD` returned:

  ```text
  {"emptyItemOrderAccepted":true,"emptyCVItemIdAccepted":true}
  ```

- Go rejects an explicitly submitted empty `itemOrder` entry (`backend/internal/api/cv_revision.go:129-139`), so the TypeScript and Go canonical contracts already disagree.
- More seriously, Go's CV item validation treats any string—including `""`—as a valid required ID (`backend/internal/api/cv_revision.go:311-314`, `392-455`). `normalizeCVItemOrders` then deterministically appends every CV item ID to the layout (`245-287`). Therefore a commit containing an item with `id: ""` and an otherwise canonical layout without `itemOrder` produces `itemOrder: [""]` after the only layout-validation pass (`202-242`). The normalized layout is not revalidated before it is persisted by commit (`619-665`).
- On the next `GET /api/cv/:id`, `normalizeCVLayout` applies the backend's empty-ID rejection to that stored layout (`535-560`, `99-169`), so a commit can create current state that the read path reports as unreadable.
- Existing schema tests cover duplicate nodes/item references and unknown keys, while backend tests cover unknown item references, but neither covers empty CV item IDs or post-normalization revalidation (`frontend/packages/schema/test/cv-layout.test.ts`; `frontend/packages/schema/test/cv.test.ts`; `backend/internal/api/cv_revision_test.go:272-290`).

**Impact**

A malformed client or an accepted AI operation can submit a schema-valid item with an empty ID. The commit boundary can persist an internally invalid canonical layout and make the CV fail on its next load. Even before persistence, the shared client schema can approve a layout that the server rejects, violating the claimed cross-boundary canonical contract.

**Required correction**

Require non-empty stable IDs in both Zod and Go for CV items and layout item references, keep the two contracts aligned, and re-run strict layout validation after `normalizeCVItemOrders` before updating `cv_documents` or inserting a revision. Add API tests proving an empty item ID cannot commit and that every successfully committed normalized layout can be read back.

#### 2. Prior Finding 6 remains: activities render, but the field-to-render contract is still incomplete and `printStyle` is not operational

**Evidence**

- Activities now have a canonical node and renderer, and activity organization/role/dates/highlights appear in editor, preview, and print (`frontend/packages/schema/src/cv-layout.ts:3-14`, `128-142`; `frontend/apps/web-spa/src/components/CVBlockRenderer.tsx:193-199`, `222-237`). That part of the prior finding is resolved.
- The registered `location` field is explicitly allowed in both `header` and `summary` (`frontend/packages/schema/src/cv-layout.ts:83-99`). The inline field mapping also permits editing it from either node (`frontend/apps/web-spa/src/lib/cv-store.ts:21-29`, `63-70`).
- The renderer emits `location` only from the header (`frontend/apps/web-spa/src/components/CVBlockRenderer.tsx:124-147`). The summary renderer handles summary, career objective, and fallback availability, but never location (`150-157`). If the reversible layout hides Header and leaves Summary visible, a catalog-valid summary location disappears from editor, preview, and PDF.
- A direct SSR renderer probe with Header hidden and Summary visible returned:

  ```text
  {"locationText":false,"locationField":false}
  ```

- Other valid stored fields remain variant-inconsistent: website is present only in the print header, while `avatarUrl` and experience `current` are not rendered by the shared resolver (`frontend/packages/schema/src/cv.ts:31-42`, `53-65`; `frontend/apps/web-spa/src/components/CVBlockRenderer.tsx:124-147`, `159-166`). A direct editor-variant probe returned:

  ```text
  {"website":false,"avatar":false,"current":false}
  ```

- `RegisteredValue` and `RegisteredHighlights` serialize `printStyle` only as a `data-print-style` attribute (`frontend/apps/web-spa/src/components/CVBlockRenderer.tsx:53-64`). `PRINT_CSS` has no selector for that attribute, and the renderer does not branch on `definition.printStyle` (`frontend/apps/web-spa/src/lib/print-css.ts:1-3`). For example, the catalog's `tags` style is still rendered as a comma-joined span. The tests assert the attribute exists, not that the declared print behavior is applied (`frontend/apps/web-spa/test/cv-layout-renderer.ui.test.tsx:119-143`; `frontend/apps/web-spa/test/print.test.ts:75-76`).
- The real PDF test now proves activities and availability survive PDF generation, but its fixture does not include or assert every registered field/allowed placement (`frontend/apps/web-spa/test/print-e2e.int.test.ts:15-25`, `73-100`).

**Impact**

The activity omission is fixed, but valid registered data can still disappear under a supported visibility arrangement, and editor/preview/print do not yet share a complete stored-field contract. Catalog `printStyle` remains metadata rather than rendering behavior, so the catalog is not actually authoritative for print fidelity.

**Required correction**

Define the output placement/fallback for each catalog field in every allowed node, render every supported stored field consistently (or explicitly remove unsupported fields from the production contract), and make `printStyle` select real markup/style behavior. Extend the actual Playwright/PDF fixture to contain and assert every registered field, including Header-hidden/Summary-visible placement.

### Medium

#### 3. Prior Finding 11 remains: provenance survives manual removal of the AI change and misattributes a later manual revision

**Evidence**

- `applyAIDraft` records a provenance entry whenever the proposed next draft differs from the current draft (`frontend/apps/web-spa/src/lib/cv-store.ts:210-222`).
- `updateDraft` preserves the entire provenance list for all manual edits and does not reconcile whether those edits overwrite or revert the AI-authored change (`199-208`).
- `saveDraft` labels the whole revision `source: 'ai'` whenever any pending entry remains, regardless of whether the saved snapshot still contains that entry's change (`236-245`). IDs allow the in-flight save to clear only entries included in its snapshot (`250-266`), but the entries are not tied to the content/layout delta they describe.
- A direct store probe performed this sequence: apply AI title → manually restore the committed title → make a separate manual title edit → Save. The emitted commit body was:

  ```text
  {"source":"ai","message":"AI title","pending":[]}
  ```

- The new tests cover AI plus manual edits, AI accepted during an in-flight save, and an AI application that is a no-op at application time (`frontend/apps/web-spa/test/cv-store.test.ts:190-222`). They do not cover an initially effective AI change that is later manually reverted or overwritten before Save.

**Impact**

Revision history can still report `source='ai'` and retain an AI proposal summary when no AI-authored change survives in the committed snapshot. This is the inverse of the original loss-of-provenance bug, but it violates the same requirement that provenance describe the exact saved draft/version.

**Required correction**

Associate each provenance entry with the actual content/layout delta or paths it contributed, reconcile entries when later edits remove those contributions, and derive source/message from the exact save snapshot. Preserve the current per-save-ID behavior for newer AI work accepted while an older save is in flight. Add a regression test for AI change → manual revert/overwrite → unrelated manual save.

## Disposition of all 11 prior findings

| Prior finding | Status | Re-review evidence |
|---|---|---|
| 1. SSR print consumes wrong API shape | **Resolved** | The handler validates `body.cv.profileSnapshot` with `CVSchema`, validates authoritative outer `body.cv.layout`, and renders that pair (`frontend/apps/web-spa/src/server/print.tsx:1-57`). Unit SSR tests use the `CVEnvelope` shape, malformed snapshots return 502, and the fresh Playwright run produced valid A4 PDFs. |
| 2. CV-local snapshots are not authority | **Resolved** | Current GET reads `c.profile_snapshot` (`backend/internal/api/cv_revision.go:535-560`); Go export reads it too (`backend/internal/api/server.go:268-315`). Commit/restore update only `cv_documents` plus `cv_revisions` (`backend/internal/api/cv_revision.go:619-716`). Legacy v2 PATCH is locked and rejected after revision history exists (`backend/internal/api/server.go:407-465`). The divergence integration test passes. |
| 3. Stale saves and response mismatch | **Resolved** | Commit and restore require `baseRevision`, compare it under the CV row lock, and return a 409 conflict (`backend/internal/api/cv_revision.go:590-665`, `668-730`, `794-890`). Responses are built directly from the inserted revision snapshot (`732-734`), not a later mutable reload. The concurrent-writer and stale-restore tests pass. |
| 4. Download implicitly commits | **Resolved** | A clean builder opens print directly; a dirty builder requires Save-and-download, Discard-and-download, or Cancel (`frontend/apps/web-spa/src/routes/BuilderRoute.tsx:44-63`, `158-170`). Preview download no longer calls `saveDraft` (`frontend/apps/web-spa/src/routes/PreviewRoute.tsx:6-27`). UI tests prove Cancel/Discard do not commit and only Save creates a revision. |
| 5. Restore destroys dirty draft | **Resolved** | Restore is disabled with actionable copy while dirty (`frontend/apps/web-spa/src/components/VersionHistoryPanel.tsx:181-203`), and the store independently rejects before any request (`frontend/apps/web-spa/src/lib/cv-store.ts:280-312`). Both UI and store regression tests pass. |
| 6. Renderer omits sections/fields | **Unresolved** | Activities and the previously listed print fields render, but allowed summary `location` disappears when Header is hidden, other stored fields remain variant-inconsistent, and `printStyle` is not behavioral. See Blocking Finding 2. |
| 7. Layout accepts incomplete/duplicate/inconsistent state | **Unresolved** | Canonical node count/type/id and duplicate references are enforced, and backend item references are cross-checked. Empty item IDs/references remain schema-valid, TypeScript and Go disagree, and normalization can persist a layout the next GET rejects. See Blocking Finding 1. |
| 8. AI permits unknown/forbidden fields | **Resolved** | CV/layout object boundaries are strict, the client returns parsed schema output, and both client/server use explicit allowlists that reject unknown fields, padding/line-height, legacy `activeSections`, and node deletion (`frontend/apps/web-spa/src/lib/cv-patch.ts:10-118`; `backend/internal/api/server.go:1958-2075`; `frontend/packages/schema/src/cv.ts:31-199`). Focused tests pass. |
| 9. Visibility has competing authorities | **Resolved** | The renderer filters only `layout.nodes[].visible` (`frontend/apps/web-spa/src/components/CVBlockRenderer.tsx:235-237`). Compatibility flags are folded into layout on read and synchronized from layout thereafter (`frontend/apps/web-spa/src/lib/layout-draft.ts:72-127`; `frontend/apps/web-spa/src/lib/cv-store.ts:122-125`). Legacy recovery tests pass. |
| 10. Catalog aliases corrupt content | **Resolved** | Availability, team size, tech stack, and contribution now have independent typed schema properties (`frontend/packages/schema/src/cv.ts:31-80`). Store mapping uses those properties and no longer encodes magic highlight prefixes (`frontend/apps/web-spa/src/lib/cv-store.ts:21-109`). Round-trip and marker-like bullet tests pass. |
| 11. AI provenance is unversioned component state | **Unresolved** | Provenance moved into the store and handles mixed/in-flight additions, but is not reconciled when manual edits remove AI contributions. See Blocking Finding 3. |

## Fresh verification

```text
cd backend && go test ./... -count=1
  PASS: cmd/worker, internal/api, internal/pii; cmd/api has no tests

cd frontend && npm test -- --run
  PASS: 26 files, 192 tests

cd frontend && npm run typecheck
  PASS: core and SPA TypeScript checks

cd frontend && npx vitest run --project integration apps/web-spa/test/print-e2e.int.test.ts
  PASS: 1 file, 2 tests; actual generated PDFs reported A4 and the long fixture reached multiple pages
```

The frontend run still emits an escaped real request during `routing.ui.test.tsx`:

```text
GET http://localhost:3000/api/cv/cv-1 401 (Unauthorized)
```

That warning does not fail the suite and is not counted among the three unresolved prior findings, but the routing test still has an asynchronous mock-boundary leak.

## Merge gate

Correct the remaining portions of prior Findings 6, 7, and 11 and add the missing boundary regressions before merge. In particular, a successful commit must be guaranteed readable, every allowed registered-field placement must survive the actual PDF path, and revision provenance must describe only AI contributions present in the exact committed snapshot.

## Round 2 fix verification

The three unresolved findings above were fixed in the round-2 implementation pass.

- Finding 7: Zod item IDs and `itemOrder` references now require non-empty strings; Go normalization applies the same identifier rule and revalidates the normalized layout before persistence. Commit tests cover empty IDs/references and successful item-order normalization with GET read-back.
- Finding 6: Header-hidden/Summary-visible rendering now carries location and fallback contact fields; website, avatar, current-role presentation, activities, registered tags, blocks, and date ranges use the shared renderer across editor/preview/print. `printStyle` now drives classes and tag markup/CSS. SSR and Playwright PDF assertions cover the real `CVEnvelope`, fallback placement, registered fields, and generated PDF text.
- Finding 11: AI provenance stores content deltas, reconciles them against manual edits, preserves mixed edits and newer in-flight AI entries, and labels a later unrelated manual save as user after an AI contribution is reverted. A regression test covers that sequence.

Verification completed:

```text
cd frontend && npm test -- --run
  PASS: 26 files, 196 tests
cd frontend && npm run typecheck
  PASS: core and SPA TypeScript checks
cd frontend && npm run test:int -- --run apps/web-spa/test/print-e2e.int.test.ts
  PASS: 1 file, 2 actual Playwright/PDF tests
cd backend && go test ./... -count=1
  PASS: all backend packages
cd frontend && npm run db:roundtrip-check
  PASS: 1 valid v2 profile, 0 errors
```

The existing routing test still logs a non-failing 401 request warning from its async mock boundary; it is unrelated to these three findings. No migration was required.
