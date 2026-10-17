# Professional presentation template

Local visual branch: `codex/professional-template`, based on Carlos's `3ddf1fc`.

The theme uses ivory surfaces, deep navy, restrained brass, editorial serif
headings, readable form text, consistent cards and visible keyboard focus.
The existing task characters and courtroom interactions are retained.

## Files

- `app/professional-template.css`: scoped visual tokens and responsive styling.
- `app/layout.tsx`: imports that stylesheet after the original styles.
- `components/trial-experience.tsx`: the initial status reads Ready until a trial
  returns its actual source. Backend result objects are not modified.

To reuse the visual template, copy the stylesheet and import it last in the root
layout. Removing that single import restores the original visual theme.

## Verification

- TypeScript completes with no errors.
- The docket was inspected at desktop width and at 390px with populated tasks;
  no horizontal overflow was observed.
- Courtroom, results and the court-order panel were inspected in a separate
  temporary mock preview. The panel title contrast was corrected during review.
- No new dependencies, backend edits, provider calls or backend restarts were
  made for the visual template. The regular localhost:3000 preview retains its
  existing API configuration.

This branch is local and has not been pushed to Carlos's shared frontend branch.
