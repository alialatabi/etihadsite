import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '@/config/defaults';
import { builder, fill } from '@/content/ar';
import { SUPABASE_MAX_UPLOAD_BYTES } from '@/lib/storage/supabase';
import { uploadLimitMb } from '@/lib/upload-limit';

describe('uploadLimitMb', () => {
  it('turns bytes into whole megabytes, rounding down', () => {
    expect(uploadLimitMb(15 * 1024 * 1024)).toBe(15);
    expect(uploadLimitMb(10 * 1024 * 1024)).toBe(10);
    expect(uploadLimitMb(15 * 1024 * 1024 - 1)).toBe(14);
    expect(uploadLimitMb(5_000_000)).toBe(4);
    expect(uploadLimitMb(1024)).toBe(1);
  });

  it('the default limit is 15 MB and the bucket mirror agrees with it', () => {
    expect(DEFAULT_SETTINGS.maxUploadBytes).toBe(15_728_640);
    expect(SUPABASE_MAX_UPLOAD_BYTES).toBe(15_728_640);
    expect(uploadLimitMb(DEFAULT_SETTINGS.maxUploadBytes)).toBe(15);
  });

  it('the upload copy carries the real limit, never a hard-coded one', () => {
    const mb = uploadLimitMb(DEFAULT_SETTINGS.maxUploadBytes);
    for (const t of [builder.upload.accepted, builder.upload.acceptedCustom, builder.upload.errors.too_large]) {
      expect(t).toContain('{mb}');
      expect(fill(t, { mb })).toContain('15');
      expect(fill(t, { mb })).not.toContain('10');
    }
  });
});
