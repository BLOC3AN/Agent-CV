# CV Typography Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a Vietnamese/English-safe font selector and independent body, section-title, and header font sizes shared by editor, preview, and print.

**Architecture:** Extend the existing `CVDesign` with optional typography fields and preserve `fontSize` as the legacy body fallback. Normalize typography at render boundaries, expose CSS variables from the shared CV surfaces, and make the Design tab edit the same draft used by Save/revisions.

**Tech Stack:** Zod schema, TypeScript React, Tailwind UI controls, shared CV renderer, print CSS, Vitest Testing Library.

## Global Constraints

- `Auto` means `Calibri, Arial, sans-serif`.
- Supported fonts are `Auto`, `Calibri`, `Arial`, `Times New Roman`, `Roboto`, `Open Sans`, and `Lato`.
- Defaults are body `10.5pt`, section title `11pt`, and header `20pt`.
- Body range is `9–14pt`, section-title range is `10–16pt`, header range is `16–28pt`.
- Preserve the existing `fontSize` field and Save/revision API.
- Do not change A4 dimensions, spacing behavior, or pagination.

### Task 1: Add typography schema and normalization

**Files:**
- Modify: `frontend/packages/schema/src/cv.ts`
- Modify: `frontend/apps/web-spa/src/types.ts`
- Create or modify: `frontend/apps/web-spa/src/lib/cv-typography.ts`
- Test: `frontend/packages/schema/test/cv.test.ts`
- Test: `frontend/apps/web-spa/test/cv-typography.test.ts`

**Interfaces:**
- Produce `CVFont` and `CVTypography` types plus `resolveCVTypography(design)` returning `{ fontFamily, bodyFontSize, sectionTitleFontSize, headerFontSize }`.
- Validate supported font names and numeric ranges through the existing Zod design schema.

- [ ] Write failing schema and normalization tests for Auto, defaults, legacy `fontSize`, and invalid ranges.
- [ ] Run the focused unit tests and verify they fail because fields/helper do not exist.
- [ ] Add optional schema fields, typed font union, and the normalization helper.
- [ ] Run the focused unit tests and verify they pass.

### Task 2: Add Design tab controls

**Files:**
- Modify: `frontend/apps/web-spa/src/components/CVEditorView.tsx`
- Test: `frontend/apps/web-spa/test/cv-typography.ui.test.tsx`

**Interfaces:**
- Design controls call the existing `updateDesign(field, value)` draft update path.
- Controls expose labels `Font chữ`, `Cỡ chữ nội dung`, `Cỡ tiêu đề section`, and `Cỡ header`.

- [ ] Write failing UI tests for all options, Auto selection, and three independent values.
- [ ] Run the focused UI tests and verify they fail.
- [ ] Replace the existing font selector options and add the three controls with the specified ranges/default fallback display.
- [ ] Run the focused UI tests and verify they pass.

### Task 3: Share typography across editor, preview, and print

**Files:**
- Modify: `frontend/apps/web-spa/src/components/CVEditorView.tsx`
- Modify: `frontend/apps/web-spa/src/components/PreviewModal.tsx`
- Modify: `frontend/apps/web-spa/src/server/print.tsx`
- Modify: `frontend/apps/web-spa/src/lib/print-css.ts`
- Test: `frontend/apps/web-spa/test/cv-typography.ui.test.tsx`
- Test: `frontend/apps/web-spa/test/preview-print-surface.ui.test.tsx`

**Interfaces:**
- Every CV root exposes `--cv-font-family`, `--cv-body-size`, `--cv-section-title-size`, and `--cv-header-size`.
- Print selectors consume the variables instead of hard-coded body/section/header sizes.

- [ ] Write failing assertions for CSS variables and Auto’s Calibri fallback on editor/preview/print roots.
- [ ] Run focused tests and verify the new assertions fail.
- [ ] Apply the normalized typography to all three surfaces and update print CSS while preserving A4/pagination.
- [ ] Run focused UI tests and verify they pass.

### Task 4: Full verification and commit

**Files:**
- Verify all changed files and tests.

- [ ] Run `npm run test:unit -- --run`.
- [ ] Run `npm run test:ui -- --run`.
- [ ] Run `npm run typecheck`.
- [ ] Run `git diff --check` and inspect status.
- [ ] Commit implementation as `feat: add CV typography controls`.

