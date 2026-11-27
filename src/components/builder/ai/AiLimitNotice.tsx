import { MessageCircle, TriangleAlert } from 'lucide-react';
import { builder } from '@/content/ar';
import { whatsappUrl } from '@/lib/parse/phone';
import { aiLimitWhatsappText } from './ai-logic';

/**
 * The daily AI limit is reached: the limit text and, when the shop has a WhatsApp number, a link that opens a chat
 * with the customer's idea already written. The link sits below the box (the box text is a paragraph).
 */
export function AiLimitNotice({ whatsapp, idea }: { whatsapp: string; idea: string }) {
  return (
    <div className="space-y-3">
      <div role="status" className="flex items-start gap-3 rounded-[2px] border border-brand-ink/30 bg-brand-tint p-4 text-sm text-brand-ink">
        <TriangleAlert className="size-5 shrink-0" aria-hidden />
        <p className="min-w-0 flex-1">{builder.ai.errors.ip_limit}</p>
      </div>
      {whatsapp && (
        <a
          href={whatsappUrl(whatsapp, aiLimitWhatsappText(idea))}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-12 items-center justify-center gap-2 rounded-[2px] bg-[#25D366] px-5 text-base font-bold text-[#052e16] focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-ink"
        >
          <MessageCircle className="size-5" aria-hidden />
          {builder.ai.limitWhatsapp.button}
        </a>
      )}
    </div>
  );
}
