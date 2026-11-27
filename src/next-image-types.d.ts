// Static image imports (`import logo from '.../softy-mark.png'`) are typed by next/image-types/global.
// next-env.d.ts also references it, but that file is git-ignored and only written by `next dev`/`next build`,
// so without this line `pnpm check` fails in a fresh checkout before the first build.
/// <reference types="next/image-types/global" />
