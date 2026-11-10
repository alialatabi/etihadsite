/**
 * Marks every /admin page so globals.css can drop the decorative sticker pattern there
 * (owner: the admin became hard to read after the pattern was added). Admin is a work tool:
 * plain, calm background.
 */
export default function AdminTemplate({ children }: { children: React.ReactNode }) {
  return <div data-admin>{children}</div>;
}
