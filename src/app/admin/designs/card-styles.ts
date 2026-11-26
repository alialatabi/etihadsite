/**
 * Button classes of a design card. Cards are narrow (two per row on a phone), so unlike `btn` from the admin
 * kit these may wrap their text; they are still at least 44px tall.
 */
const BASE =
  'inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl px-3 py-2 text-center text-[14px] font-bold leading-snug transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#d01c4a] disabled:pointer-events-none disabled:opacity-60';

export const cardBtn = {
  outline: `${BASE} border border-[#e7dfdf] bg-white text-[#121f34] hover:bg-[#f7f0ef]`,
  whatsapp: `${BASE} bg-[#25d366] text-[#052e16] hover:bg-[#20bd5a]`,
  danger: `${BASE} border border-[#f3c4cf] bg-white text-[#b8163f] hover:bg-[#ffeaed]`,
} as const;
