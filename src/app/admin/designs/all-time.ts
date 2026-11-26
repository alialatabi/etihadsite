import type { StorageAdapter } from '@/lib/types';

/**
 * «الكل» on the admin designs page: every stored CUSTOMER design, the same population as «اليوم» and «الشهر»
 * (those count kind 'image'; staff designs are kind 'staff_image' and show in the gallery only). null = unknown
 * (no adapter method). A storage that rejects the staff filter (the staff migration is not applied yet, so there
 * is no staff column and no staff design) answers with its plain total, which is then the same number.
 */
export async function customerAllTime(storage: Pick<StorageAdapter, 'aiListGenerations'>): Promise<number | null> {
  if (!storage.aiListGenerations) return null;
  try {
    return (await storage.aiListGenerations({ limit: 0, offset: 0, maker: 'customer' })).total;
  } catch {
    return (await storage.aiListGenerations({ limit: 0, offset: 0 })).total;
  }
}
