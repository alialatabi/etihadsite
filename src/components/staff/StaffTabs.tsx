'use client';

import { Tabs } from '@base-ui/react/tabs';
import { staff } from '@/content/ar';
import type { LayoutSettings, QualitySettings } from '@/lib/types';
import { StaffReceipts } from './receipts/StaffReceipts';
import { StaffSheets } from './StaffSheets';

const TAB =
  'min-h-11 flex-1 cursor-pointer rounded-xl px-4 py-2 text-base font-bold text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 data-[active]:bg-brand data-[active]:text-brand-foreground data-[active]:shadow-sm sm:flex-none sm:px-8';
const PANEL = 'space-y-6 outline-none focus-visible:ring-3 focus-visible:ring-ring/50';

/**
 * The staff page's two jobs: stickers and receipts. Both panels stay mounted (`keepMounted`), so
 * switching tabs never loses the cards, their decode queue or their object URLs.
 */
export function StaffTabs({ layoutSettings, quality }: { layoutSettings: LayoutSettings; quality: QualitySettings }) {
  return (
    <Tabs.Root defaultValue="stickers" className="space-y-6">
      <Tabs.List aria-label={staff.tabs.label} className="flex gap-1 rounded-2xl border bg-muted p-1">
        <Tabs.Tab value="stickers" className={TAB}>
          {staff.tabs.stickers}
        </Tabs.Tab>
        <Tabs.Tab value="receipts" className={TAB}>
          {staff.tabs.receipts}
        </Tabs.Tab>
      </Tabs.List>
      <Tabs.Panel value="stickers" keepMounted className={PANEL}>
        <p className="text-sm text-muted-foreground">{staff.intro}</p>
        <StaffSheets layoutSettings={layoutSettings} quality={quality} />
      </Tabs.Panel>
      <Tabs.Panel value="receipts" keepMounted className={PANEL}>
        <p className="text-sm text-muted-foreground">{staff.receipts.intro}</p>
        <StaffReceipts quality={quality} />
      </Tabs.Panel>
    </Tabs.Root>
  );
}
