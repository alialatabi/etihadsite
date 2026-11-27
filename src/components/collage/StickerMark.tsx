import Image from 'next/image';
import { cn } from '@/lib/utils';
// Static import: the optimizer source becomes a content-hashed /_next/static/media file (immutable caching).
import softyMark from '../../../public/brand/softy-mark.png';

/** The Softy mark as a die-cut sticker (white edge, shadow). `alt=""` unless it is the only content of a link. */
export function StickerMark({
  size = 40,
  tilt = -6,
  priority,
  alt = '',
  className,
}: {
  size?: number;
  /** Degrees, clamped to -10..10. */
  tilt?: number;
  priority?: boolean;
  alt?: string;
  className?: string;
}) {
  const deg = Math.min(10, Math.max(-10, tilt));
  return (
    <Image
      src={softyMark}
      alt={alt}
      width={size}
      height={size}
      priority={priority}
      className={cn(size < 48 ? 'sticker-edge-sm' : 'sticker-edge', 'shrink-0', className)}
      style={{ rotate: `${deg}deg` }}
    />
  );
}
