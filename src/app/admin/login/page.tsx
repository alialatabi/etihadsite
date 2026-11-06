import { redirect } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { admin } from '@/content/ar';
import { verifySession } from '@/lib/auth/session';
import { loginAction } from '../actions';

export const dynamic = 'force-dynamic';

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (await verifySession()) redirect('/admin');
  const { error } = await searchParams;
  return (
    <Card className="mx-auto mt-10 max-w-sm">
      <CardHeader>
        <CardTitle>{admin.login.title}</CardTitle>
      </CardHeader>
      <CardContent>
        <form action={loginAction} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="password">{admin.login.password}</Label>
            <Input id="password" name="password" type="password" required autoFocus autoComplete="current-password" dir="ltr" />
          </div>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error === 'rate' ? admin.login.rateLimited : admin.login.error}
            </p>
          ) : null}
          <Button type="submit">{admin.login.submit}</Button>
        </form>
      </CardContent>
    </Card>
  );
}
