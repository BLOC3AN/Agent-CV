# Task 3 report: explicit CV draft save workflow

## Changed files

- `frontend/apps/web-spa/src/lib/cv-store.ts`
- `frontend/apps/web-spa/src/routes/BuilderRoute.tsx`
- `frontend/apps/web-spa/src/components/CVEditorView.tsx`
- `frontend/apps/web-spa/src/components/ChatPanel.tsx`
- `frontend/apps/web-spa/src/lib/api.ts`
- `frontend/apps/web-spa/src/lib/cv-patch.ts`
- `backend/internal/api/server.go`
- `backend/internal/api/server_test.go`
- `frontend/apps/web-spa/test/cv-store.test.ts`
- `frontend/apps/web-spa/test/api.test.ts`
- `frontend/apps/web-spa/test/cv-editor-save.ui.test.tsx`

## State decisions

- The store keeps independent `committed` and `draft` `{ cv, layout }` documents. Incoming and replacement documents are cloned so editor mutations cannot alter the committed snapshot.
- `dirty` uses recursive structural equality for the entire document, including layout, and is therefore insensitive to object key insertion order.
- `updateDraft` never performs I/O. `saveDraft` is the only editor save path and creates a revision through `commitCV`; success advances committed state and only replaces draft when the user has not edited again while the request was in flight.
- `discardDraft` replaces the draft with committed state. `reload` explicitly replaces both copies with the latest server document. A `cv` alias remains available for existing preview and assistant consumers while editor callers use `draft` directly.

## Leave-confirmation decisions

- Ctrl+S and Cmd+S prevent the browser save action and call the same explicit save operation as the editor button.
- Dirty route navigation is blocked with a custom Save, Discard, Cancel dialog. Save proceeds only after a successful commit; Discard restores committed state then proceeds; Cancel resets the blocker and preserves the draft.
- `beforeunload` is installed only while dirty. Browsers control the final native close/refresh wording.
- AI proposal settlement is draft-only. The backend records `proposed_patches.status` and selected indices, then returns `selectedOps`; it does not update `profiles` or insert `profile_revisions`. Settlement is serialized with a row lock.
- `ChatPanel` forwards selected operations, and `BuilderRoute` applies them immutably to the local draft through `applyChatOps`. Explicit `saveDraft`/`commitCV` remains the only profile/revision commit path.

## Tests and results

- Test-first red verification: store tests initially failed because draft APIs did not exist and UI tests failed because save/leave controls were absent. The structural-key-order regression test also failed before deep equality replaced stringification.
- Focused API/editor suites: 31 passing tests.
- Full frontend unit/UI suite: 126 passing tests across 20 files.
- Backend `go test ./...`: passed.
- Frontend `npm run typecheck`: passed for core and SPA TypeScript projects.

## Concerns

- Browser `beforeunload` dialogs cannot present custom Save/Discard/Cancel controls; the custom three-way decision is available for in-app route changes, while close/refresh uses the browser-native warning.
- The API envelope layout is schema-inferred with optional fields at the TypeScript boundary, so the store narrows it to the established editor `CVLayout` contract after the server-provided response is received.
- Proposal operations are applied against the current local draft; if a patch path is no longer valid after intervening edits, the UI reports the application error and explicit Save is not attempted. Task 6 can add richer proposal conflict/rebase semantics.
