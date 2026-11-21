import { TriangleAlert } from 'lucide-react';
import { builder, common } from '@/content/ar';
import { fillLtr } from '@/components/fill-ltr';
import { Ltr } from '@/components/Ltr';
import { safeFormatCm } from '../safe';
import type { TextWarning } from './ai-logic';

/**
 * «الكتابة كثيرة على هذا القياس»: a warning and a recommendation, never a block. Shown on the design page, on the
 * review box and on the arrangement step, always from `textWarning()` so the three agree.
 */
export function TextWarningNote({ warning }: { warning: TextWarning }) {
  if (!warning) return null;
  return (
    <p role="status" className="flex items-start gap-2 rounded-xl border border-brand/50 bg-brand/10 p-3 text-sm">
      <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>
        {warning.kind === 'enlarge'
          ? fillLtr(builder.ai.tooMuchText, {
              size: (
                <>
                  <Ltr>{safeFormatCm(warning.sizeUm)}</Ltr> {common.units.cm}
                </>
              ),
            })
          : builder.ai.tooMuchTextReduce}
      </span>
    </p>
  );
}
