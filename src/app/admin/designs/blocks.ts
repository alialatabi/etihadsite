import 'server-only';
import { cache } from 'react';
import { getStorage } from '@/lib/storage';
import type { AiBlock } from '@/lib/types';

/** Blocked IP keys, read once per render: the admin layout's badge and /admin/designs both need them. */
export const listAiBlocks = cache(async (): Promise<AiBlock[]> => (await getStorage().aiListBlocks?.()) ?? []);
