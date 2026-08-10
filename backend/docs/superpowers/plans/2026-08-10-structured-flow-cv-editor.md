# Structured Flow CV Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a single-column structured CV canvas with nested drag ordering, inline editing, registered fields, explicit draft saving, AI-to-draft proposals, and revision history with safe rollback.

**Architecture:** Keep the existing CV profile snapshot as the content source and use the existing `cv_documents.layout` JSONB column for ordered visible nodes. Add CV-scoped immutable revisions containing both content and layout. The SPA keeps a committed snapshot and a local draft; only Save/Ctrl+S sends an atomic commit, while the shared renderer consumes the ordered layout for editor, preview, thumbnail, and PDF.

**Tech Stack:** React 19 + TypeScript, React Router, Tailwind CSS v4, native HTML5 drag events, Go `database/sql` API, PostgreSQL JSONB, existing `profile_revisions`/proposal infrastructure, Vitest + Testing Library + Playwright/pdfinfo.

## Global Constraints

- v1 supports one vertical column only; two-column templates and arbitrary canvas coordinates are out of scope.
- v1 uses the registered field catalog; custom user-defined schema fields are deferred.
- Hide is reversible and does not remove source data.
- Save is explicit; background autosave is not used for editor content/layout.
- Header and Footer are movable nodes but default to conventional top/bottom positions.
- AI proposals apply to the SPA draft and do not commit server state before Save.
- No persisted pixel positions, arbitrary widths, per-node line-height, or user-controlled padding.

---

## Task 1: Define layout and registered-field contracts

**Files:**
- Create: `frontend/packages/schema/src/cv-layout.ts`
- Modify: `frontend/packages/schema/src/cv.ts`
- Modify: `frontend/packages/schema/src/index.ts`
- Modify: `frontend/apps/web-spa/src/types.ts`
- Create: `frontend/apps/web-spa/src/lib/cv-fields.ts`
- Test: `frontend/packages/schema/test/cv-layout.test.ts`

**Interfaces:**

Produce `CVLayoutSchema`, `CVLayout`, `LayoutNode`, `CVFieldDefinition`, and a stable `DEFAULT_CV_LAYOUT`. `LayoutNode` must contain `{ id, type, visible, itemOrder? }`; `type` is the nine top-level node types from the spec. The field catalog must expose `key`, `label`, `valueType`, `allowedIn`, and `printStyle`.

- [ ] **Step 1: Write failing schema tests** for default normalization, valid nested item order, rejecting unknown node types, and rejecting persisted pixel-position properties.
- [ ] **Step 2: Run the focused schema test**:

```bash
cd frontend
npx vitest run packages/schema/test/cv-layout.test.ts --project unit
```

Expected: FAIL because the layout schema and catalog do not exist.

- [ ] **Step 3: Implement the contracts** and export them through `packages/schema/src/index.ts`. Add `layout` to `CVSchema` with a default-normalization path so legacy CV payloads without layout still parse into the conventional order. Keep existing `activeSections` readable during compatibility.
- [ ] **Step 4: Mirror the public types** in the SPA and export the field catalog from a focused `src/lib/cv-fields.ts` module; do not duplicate field metadata in components.
- [ ] **Step 5: Re-run schema and existing CV tests**; expected result is all focused tests passing with legacy CV fixtures unchanged.
- [ ] **Step 6: Commit**:

```bash
git add frontend/packages/schema frontend/apps/web-spa/src/types.ts frontend/apps/web-spa/src/lib/cv-fields.ts
git commit -m "feat: define structured CV layout contracts"
```

## Task 2: Add CV-scoped revision storage and atomic commit APIs

**Files:**
- Create: `backend/db/migrations/014_cv_revisions.sql`
- Modify: `backend/internal/api/server.go`
- Create: `backend/internal/api/cv_revision.go`
- Modify: `frontend/apps/web-spa/src/lib/api.ts`
- Test: `backend/internal/api/cv_revision_test.go`
- Test: `frontend/apps/web-spa/test/api.test.ts`

**Interfaces:**

Add these routes:

```text
POST /api/cv/:id/commit
  body: { cv: CV, layout: CVLayout, source: "user" | "ai", message?: string }
  response: { cv: CVEnvelope, revision: CVRevision }

GET /api/cv/:id/revisions
  response: { revisions: CVRevisionSummary[] }

GET /api/cv/:id/revisions/:revisionId
  response: { revision: CVRevision, before?: CVRevisionSnapshot }

POST /api/cv/:id/revisions/:revisionId/restore
  response: { cv: CVEnvelope, revision: CVRevision }
```

`CVRevision` includes revision id/number, CV id, source, message, created time, and snapshots of both `profile_snapshot` and `layout`. The current CV endpoint must return normalized layout.

- [ ] **Step 1: Write failing DB/API tests** covering: commit creates one revision; content and layout update in one transaction; unauthorized CV access is rejected; restore creates a new revision while preserving the original and later revisions; a failed layout/content write leaves both current state and history unchanged.
- [ ] **Step 2: Run backend focused tests**:

```bash
cd backend
go test ./internal/api -run 'TestCVRevision|TestCVCommit' -count=1
```

Expected: FAIL because the migration/table/routes do not exist.

- [ ] **Step 3: Create migration 014** with `cv_revisions` keyed by CV, a unique `(cv_id, revision_number)`, JSONB content/layout snapshots, source check (`user|ai|restore`), parent revision, message, and created timestamp. Add an index for newest revisions.
- [ ] **Step 4: Implement transaction helpers** in `cv_revision.go`: ownership lookup, next revision number under row lock, commit snapshot, restore snapshot, and revision listing/preview. Do not reuse profile-only revision rows for layout history.
- [ ] **Step 5: Register routes and normalize `GET /api/cv/:id`**. Preserve existing read and export response shape while adding layout metadata.
- [ ] **Step 6: Add SPA API functions** with exact types: `commitCV`, `listCVRevisions`, `getCVRevision`, and `restoreCVRevision`. Task 3 will replace editor use of direct `saveCV` with `commitCV`.
- [ ] **Step 7: Run backend tests and migration checks**:

```bash
cd backend
go test ./internal/api -count=1
cd ../frontend
npm run db:migrate
npx vitest run apps/web-spa/test/api.test.ts --project unit
```

- [ ] **Step 8: Commit**:

```bash
git add backend/db/migrations/014_cv_revisions.sql backend/internal/api frontend/apps/web-spa/src/lib/api.ts frontend/apps/web-spa/test/api.test.ts
git commit -m "feat: add CV revision commit and restore APIs"
```

## Task 3: Replace autosave with committed/draft editor state

**Files:**
- Modify: `frontend/apps/web-spa/src/lib/cv-store.ts`
- Modify: `frontend/apps/web-spa/src/routes/BuilderRoute.tsx`
- Modify: `frontend/apps/web-spa/src/components/CVEditorView.tsx`
- Test: `frontend/apps/web-spa/test/cv-store.test.ts`
- Test: `frontend/apps/web-spa/test/cv-editor-save.ui.test.tsx`

**Interfaces:**

`useCVStore` produces:

```ts
{
  committed: { cv: CV, layout: CVLayout },
  draft: { cv: CV, layout: CVLayout },
  dirty: boolean,
  status: 'loading' | 'ready' | 'dirty' | 'saving' | 'saved' | 'error',
  updateDraft(next: DraftDocument): void,
  saveDraft(source?: 'user' | 'ai', message?: string): Promise<void>,
  discardDraft(): void,
  reload(): Promise<void>
}
```

- [ ] **Step 1: Write failing store/UI tests** proving edits do not call the network, Save creates one commit, Ctrl/Cmd+S invokes Save, Discard restores committed state, and navigation/unload warns only when dirty.
- [ ] **Step 2: Run the focused tests** and verify they fail because the store currently debounces `saveCV`.
- [ ] **Step 3: Remove the 500ms autosave timer**. Keep draft edits local, compare draft/committed structurally for `dirty`, and expose explicit save/discard operations.
- [ ] **Step 4: Add Save status and keyboard handling** in BuilderRoute/editor. `Ctrl+S` on Windows/Linux and `Cmd+S` on macOS must prevent the browser save dialog and call the same save function.
- [ ] **Step 5: Add a route-leave confirmation** for builder navigation and `beforeunload` for browser close/refresh. The dialog must offer Save, Discard, and Cancel; Cancel keeps the editor and draft intact.
- [ ] **Step 6: Run store/UI tests and existing editor tests**; expected result is no direct `saveCV` calls from editor interactions.
- [ ] **Step 7: Commit**:

```bash
git add frontend/apps/web-spa/src/lib/cv-store.ts frontend/apps/web-spa/src/routes/BuilderRoute.tsx frontend/apps/web-spa/src/components/CVEditorView.tsx frontend/apps/web-spa/test/cv-store.test.ts frontend/apps/web-spa/test/cv-editor-save.ui.test.tsx
git commit -m "feat: add explicit CV draft save workflow"
```

## Task 4: Build the structured flow renderer and Component Tree

**Files:**
- Create: `frontend/apps/web-spa/src/components/CVBlockRenderer.tsx`
- Create: `frontend/apps/web-spa/src/components/ComponentTree.tsx`
- Create: `frontend/apps/web-spa/src/lib/layout-draft.ts`
- Modify: `frontend/apps/web-spa/src/components/CVEditorView.tsx`
- Modify: `frontend/apps/web-spa/src/components/PreviewModal.tsx`
- Modify: `frontend/apps/web-spa/src/server/print.tsx`
- Test: `frontend/apps/web-spa/test/component-tree.ui.test.tsx`
- Test: `frontend/apps/web-spa/test/cv-layout-renderer.ui.test.tsx`

**Interfaces:**

`layout-draft.ts` produces pure operations:

```ts
moveNode(layout: CVLayout, nodeId: string, beforeNodeId: string | null): CVLayout
moveItem(layout: CVLayout, nodeId: string, itemId: string, beforeItemId: string | null): CVLayout
setNodeVisible(layout: CVLayout, nodeId: string, visible: boolean): CVLayout
resetDefaultLayout(layout: CVLayout): CVLayout
```

`CVBlockRenderer` accepts `{ cv, layout, variant, onSelect?, onEdit? }` and renders nodes in layout order. The print variant must use the same resolver and fixed single-column rules.

- [ ] **Step 1: Write failing pure-operation and UI tests** for top-level reorder, nested item reorder, hide/unhide without deleting content, reset default order, double-click edit activation, and rendering Header/Footer in the middle.
- [ ] **Step 2: Run focused UI tests** and verify failure before implementation.
- [ ] **Step 3: Implement pure layout operations** with immutable arrays and tests for unknown/missing ids leaving layout unchanged.
- [ ] **Step 4: Extract current hard-coded CV markup into `CVBlockRenderer`**. Each registered node type gets one renderer; no duplicate section-order logic remains in editor, preview, or print.
- [ ] **Step 5: Implement ComponentTree** with native drag events and visible drag handles. Support nested expansion for Experience/Projects/Education, double-click editing, hide/delete action, and selection callbacks. Do not add a drag-and-drop dependency.
- [ ] **Step 6: Render the tree and flow canvas from draft layout** and preserve `PaginatedA4Document` fixed A4 behavior. Add a soft non-standard-order warning and a reset button.
- [ ] **Step 7: Run UI tests plus print E2E** with Header/Footer moved and a long single-column CV.
- [ ] **Step 8: Commit**:

```bash
git add frontend/apps/web-spa/src/components frontend/apps/web-spa/src/lib/layout-draft.ts frontend/apps/web-spa/src/server/print.tsx frontend/apps/web-spa/test
git commit -m "feat: add structured CV component tree"
```

## Task 5: Add inline editing and registered field catalog UX

**Files:**
- Create: `frontend/apps/web-spa/src/components/InlineCVEditor.tsx`
- Create: `frontend/apps/web-spa/src/components/FieldCatalog.tsx`
- Modify: `frontend/apps/web-spa/src/components/ComponentTree.tsx`
- Modify: `frontend/apps/web-spa/src/components/CVBlockRenderer.tsx`
- Modify: `frontend/apps/web-spa/src/components/CVEditorView.tsx`
- Modify: `frontend/apps/web-spa/src/lib/cv-store.ts`
- Test: `frontend/apps/web-spa/test/cv-fields.ui.test.tsx`

**Interfaces:**

`InlineCVEditor` receives `{ node, item?, fieldDefinitions, draft, onDraftChange, onClose }`. `FieldCatalog` returns a registered field key and target node; it cannot create unknown keys.

- [ ] **Step 1: Write failing UI tests** for double-clicking a block/item, editing a text field, adding `careerObjective`, `teamSize`, `time`, `techStack`, and `contribution`, hiding a component while retaining data, and rejecting a field not allowed for the target node.
- [ ] **Step 2: Run the focused tests** and confirm the current editor has no inline/tree field behavior.
- [ ] **Step 3: Implement the catalog-driven form controls** with text, multiline, date/time, and tag-list controls mapped to existing CV paths. Keep all edits in draft state.
- [ ] **Step 4: Add accessible labels, Escape-to-cancel, Enter/Ctrl+Enter save-to-draft, and visible dirty state.** This is not the commit Save; it only closes the inline editor and updates draft.
- [ ] **Step 5: Run UI tests and typecheck; commit**:

```bash
git add frontend/apps/web-spa/src/components frontend/apps/web-spa/src/lib/cv-store.ts frontend/apps/web-spa/test/cv-fields.ui.test.tsx
git commit -m "feat: add catalog-driven CV inline editing"
```

## Task 6: Move AI proposals into the draft workflow

**Files:**
- Modify: `backend/internal/api/server.go`
- Modify: `frontend/apps/web-spa/src/lib/api.ts`
- Modify: `frontend/apps/web-spa/src/components/ChatPanel.tsx`
- Modify: `frontend/apps/web-spa/src/routes/BuilderRoute.tsx`
- Test: `backend/internal/api/chat_proposal_test.go`
- Test: `frontend/apps/web-spa/test/chat-panel.ui.test.tsx`

**Interfaces:**

Change proposal resolution so it records accepted/rejected op indices and returns selected structured ops without mutating `profiles` or creating a profile revision. `ChatPanel` calls `onApplyAIProposal(ops)`; BuilderRoute applies those ops to draft. The final `saveDraft('ai', proposal.summary)` commits the complete draft through `/api/cv/:id/commit`.

- [ ] **Step 1: Write failing backend/UI tests** proving accepted AI ops do not alter persisted CV before Save, selected ops apply to draft, rejected ops do not, and Save creates one CV revision with source `ai`.
- [ ] **Step 2: Run focused tests and verify current `settleChatProposal` fails** because it directly updates `profiles` and inserts `profile_revisions`.
- [ ] **Step 3: Split proposal resolution from CV commit**: keep proposal status/applied indices for audit, return selected ops, and remove profile mutation from the resolution path. Preserve ownership and proposal status validation.
- [ ] **Step 4: Apply selected JSON Patch operations client-side to draft**, including layout/order operations under the agreed layout path; reject malformed/unknown operations with a visible assistant error.
- [ ] **Step 5: Update ChatPanel copy/status** so “Đã áp dụng” means “đã đưa vào bản nháp”; show the global `Chưa lưu` state until Save.
- [ ] **Step 6: Run backend, UI, and existing chat tests; commit**:

```bash
git add backend/internal/api frontend/apps/web-spa/src/lib/api.ts frontend/apps/web-spa/src/components/ChatPanel.tsx frontend/apps/web-spa/src/routes/BuilderRoute.tsx frontend/apps/web-spa/test/chat-panel.ui.test.tsx
git commit -m "feat: apply AI CV proposals to draft only"
```

## Task 7: Implement Version History panel and restore

**Files:**
- Create: `frontend/apps/web-spa/src/components/VersionHistoryPanel.tsx`
- Modify: `frontend/apps/web-spa/src/components/CVEditorView.tsx`
- Modify: `frontend/apps/web-spa/src/lib/api.ts`
- Modify: `frontend/apps/web-spa/src/lib/cv-store.ts`
- Test: `frontend/apps/web-spa/test/version-history.ui.test.tsx`

- [ ] **Step 1: Write failing UI tests** for listing revisions, displaying source/time/message, opening before/after preview, restoring an old version as a new revision, and leaving a dirty draft untouched when history is opened.
- [ ] **Step 2: Implement panel state** alongside Properties/AI mode; loading/error/empty states must not replace the active draft.
- [ ] **Step 3: Implement preview and restore calls** using the revision APIs. Restore updates committed and draft only after the server confirms the new revision; failed restore keeps current state.
- [ ] **Step 4: Add confirmation for restore** that explicitly says it creates a new version and preserves history.
- [ ] **Step 5: Run UI/API tests and commit**:

```bash
git add frontend/apps/web-spa/src/components/VersionHistoryPanel.tsx frontend/apps/web-spa/src/components/CVEditorView.tsx frontend/apps/web-spa/src/lib frontend/apps/web-spa/test/version-history.ui.test.tsx
git commit -m "feat: add CV version history and restore"
```

## Task 8: Full integration verification and migration handoff

**Files:**
- Modify: `frontend/apps/web-spa/test/print-e2e.int.test.ts`
- Modify: `frontend/apps/web-spa/test/routing.ui.test.tsx`

- [ ] **Step 1: Add end-to-end acceptance coverage** for legacy CV normalization, default order, reordered Header/Footer, nested item order, hidden component recovery, explicit Save, AI draft, restore, and three-page A4 output.
- [ ] **Step 2: Run schema/unit/UI tests**:

```bash
cd frontend
npm test -- --run
npm run typecheck
```

- [ ] **Step 3: Run backend tests and migration validation**:

```bash
cd backend
go test ./...
cd ../frontend
npm run db:migrate
```

- [ ] **Step 4: Run print integration tests**:

```bash
cd frontend
npx vitest run apps/web-spa/test/print-e2e.int.test.ts --project integration
```

Expected: every PDF page is A4, content is single-column, and no content is clipped.

- [ ] **Step 5: Manually verify the browser flow**: edit, reorder, hide, add field, accept AI, Save, navigate away dirty, discard, open history, preview, restore, and export PDF.
- [ ] **Step 6: Run `git diff --check`, review the migration and API transaction boundaries, then commit the final integration tests**:

```bash
git diff --check
git status --short
git commit -m "test: verify structured CV editor workflow"
```

## Execution Notes

- Implement tasks in order because later tasks depend on the layout contract, commit API, and draft store interfaces.
- Use a failing test before each production behavior change and keep each task independently green.
- Do not delete or rewrite legacy CV data during migration; normalize missing layout at read time and persist only on explicit Save.
- Do not use `docker compose down -v` as part of application tests; local PostgreSQL/Redis/uploads are bind-mounted under `/home/hailt/Desktop/HR-agent/data-deploy/`.
