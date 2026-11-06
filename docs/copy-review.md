# Copy review

## Agent C needs

Strings the builder UI would like but which are not in the frozen dictionaries (closest existing key used meanwhile):

- `builder.upload.pixelsUnit` — «بكسل», to label the artwork dimensions on the design preview (currently shows only "W × H" in `<Ltr>`).
- `builder.preview.close` (or reuse `common.actions.close`) — the shared Dialog close button has an English sr-only "Close" in `components/ui/dialog.tsx` (frozen).
- `builder.offer.noOffers` — empty state when the owner has disabled every offer (currently renders an empty list).
- `builder.stepper.label` — accessible name for the step navigation (currently `builder.hero.title`).
- `builder.size.countHint` — screen-reader announcement of the per-sheet count when the size changes (currently the bare number).
- `builder.upload.removeFile` — a "remove file" action (currently only «غيّر الملف»).
