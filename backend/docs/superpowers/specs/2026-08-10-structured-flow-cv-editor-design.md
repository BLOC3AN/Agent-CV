# Structured Flow CV Editor

## Summary

Replace the current fixed-order CV editor with a single-column structured flow canvas. Users can reorder blocks and items vertically, edit content inline, add registered fields, and hide components without moving elements by arbitrary pixel coordinates. The default layout remains a polished, conventional CV order; user changes are allowed but may receive a non-blocking warning.

The editor uses an explicit draft/commit workflow. Manual edits and accepted AI changes update only the draft. `Save` or `Ctrl/Cmd+S` atomically commits content and layout as one new CV revision. Leaving a dirty editor prompts the user to save, discard, or cancel.

## UX and interaction

### Editor regions

- Left Component Tree: ordered blocks and nested items, drag handles, inline edit on double-click, visibility toggle, delete/hide action, and add-component catalog.
- Center Canvas: one vertical A4 flow with fixed padding, gap, typography, and page-break rules. Selected nodes are highlighted and can be edited inline.
- Right Panel: existing AI assistant remains available; Properties and Version History are panel modes. AI can propose content/order changes but cannot set pixel coordinates, padding, line-height, or arbitrary placement.

### Component behavior

- Top-level nodes include Header, Summary, Experience, Projects, Education, Skills, Certifications, Languages, and Footer.
- Header and Footer are normal movable nodes. They default to the conventional top/bottom positions but may be moved between other blocks.
- Experience, Projects, and Education expose nested item ordering (individual jobs, projects, or degrees).
- Delete means hide from the active layout; underlying content remains recoverable.
- Added content comes from a fixed field catalog, not arbitrary user-defined schemas in v1.
- A non-standard order displays a soft warning and never blocks saving or PDF export.
- `Restore default layout` returns only ordering/visibility to the template default; it does not delete content.

### Draft and save

- Load creates `committedVersion` and a separate `draftVersion`.
- Every content, order, visibility, or field edit marks the draft dirty but does not call the commit API.
- Save button and `Ctrl/Cmd+S` validate and commit content plus layout in one transaction.
- Text typing is grouped naturally because no revision is created until Save.
- AI proposals apply to the draft only after user approval; they do not create a revision before Save.
- Leaving with unsaved changes opens `Save / Discard / Cancel`. Browser unload uses `beforeunload` while dirty.

### Version history

The right panel can switch to Version History. Each entry shows timestamp, source (`user` or `ai`), summary/message, and a before/after preview. Restoring an old version creates a new revision containing that version's content and layout; later history is preserved and remains restorable.

## Data model and API contract

### Layout

Keep layout structure in the existing `cv_documents.layout` JSONB column and normalize missing data to the default order:

```ts
interface CVLayout {
  version: 1
  nodes: LayoutNode[]
}

interface LayoutNode {
  id: string
  type:
    | 'header' | 'summary' | 'experience' | 'projects' | 'education'
    | 'skills' | 'certifications' | 'languages' | 'footer'
  visible: boolean
  itemOrder?: string[]
}
```

No pixel positions, arbitrary widths, or per-node line-height values are persisted.

### Registered fields

Field definitions are shared by form editing, AI validation, and renderers. Initial catalog:

- Experience: role, company, time, teamSize, techStack, highlights.
- Project: name, role, time, teamSize, techStack, contribution, highlights.
- Profile: careerObjective, availability, location.
- Education: school, degree, field, time, gpa.

Fields are optional so existing CVs remain valid. Unknown fields are rejected at the schema boundary rather than silently rendered or sent to AI.

### Revision storage

Existing `profile_revisions` remains for profile/import history. Editor version history requires CV-scoped revisions because layout belongs to `cv_documents`. Add a `cv_revisions` table containing:

- CV id, monotonically increasing revision number, author/source, created time, summary/message.
- Complete profile snapshot and layout snapshot for that CV revision.
- Parent/base revision reference for auditability.

The save transaction updates the current `cv_documents.profile_snapshot` and `layout`, then inserts one `cv_revisions` row. Restore performs the same transaction using the selected revision's snapshots and inserts a new revision. Reads expose current state and revision history separately.

AI proposal acceptance must return structured operations to the SPA draft flow, rather than committing profile/CV state immediately. The final Save endpoint is the only editor commit path.

## Rendering and compatibility

- The renderer consumes `layout.nodes` and resolves node content from the CV snapshot; it must be shared by editor, preview, thumbnail, and PDF print.
- Single-column flow preserves fixed A4 padding and typography. Users cannot create horizontal drift or arbitrary spacing.
- Content may naturally continue onto the next A4 page to minimize blank space. Section headings should remain with the following content when possible.
- CVs without layout normalize to the default order and are not rewritten until the user saves.
- Existing active-section flags remain readable during migration; layout visibility becomes the presentation source of truth after normalization.

## Test and acceptance criteria

- Default legacy CV renders in the conventional order without a migration-time rewrite.
- Reordering top-level blocks and nested items updates the draft only until Save.
- Double-click editing, hide/delete, add-field, and reset-default-layout work without data loss.
- Ctrl/Cmd+S and Save create exactly one revision containing both content and layout.
- AI-approved changes remain draft-only until Save.
- Dirty navigation shows Save/Discard/Cancel; discard restores the last committed version.
- Version History shows before/after snapshots and source metadata.
- Restore creates a new revision and preserves the restored-from revision and later history.
- Header/Footer moved into the middle renders in the chosen order across editor, preview, and PDF.
- Multi-page CVs remain single-column, preserve fixed padding, and break naturally without clipping.
- Backend tests cover atomic save/restore, ownership, revision ordering, and rollback failure behavior; UI tests cover drag ordering, dirty state, keyboard save, AI-to-draft flow, and version history.

## Scope and assumptions

- v1 supports one vertical column only; two-column templates and arbitrary canvas coordinates are out of scope.
- v1 uses the registered field catalog; custom user-defined schema fields are deferred.
- Hide is reversible and does not remove source data.
- Save is explicit; background autosave is not used for editor content/layout.
