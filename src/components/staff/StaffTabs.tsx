'use client';

import { Tabs } from '@base-ui/react/tabs';
import { staff } from '@/content/ar';
import type { LayoutSettings, QualitySettings } from '@/lib/types';
import { StaffReceipts } from './receipts/StaffReceipts';
import { StaffSheets } from './StaffSheets';

const FOCUS = 'outline-none focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-ink';
const TAB = `h-11 flex-1 cursor-pointer rounded-[2px] px-4 text-base font-medium text-ink-soft transition-colors hover:bg-news ${FOCUS} data-[active]:bg-ink data-[active]:font-bold data-[active]:text-paper data-[active]:hover:bg-ink sm:flex-none sm:px-8`;
const PANEL = `space-y-6 ${FOCUS}`;

/**
 * The staff page's two jobs: stickers and receipts. Both panels stay mounted (`keepMounted`), so
 * switching tabs never loses the cards, their decode queue or their object URLs.
 */
export function StaffTabs({ layoutSettings, quality }: { layoutSettings: LayoutSettings; quality: QualitySettings }) {
  return (
    <Tabs.Root defaultValue="stickers" className="space-y-6">
      <Tabs.List aria-label={staff.tabs.label} className="flex w-full gap-1 rounded-[2px] bg-white p-1 shadow-paper sm:inline-flex sm:w-auto">
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
