import Dashboard from '@/components/dashboard';
import { headers } from 'next/headers';
export const dynamic = 'force-dynamic';
export default async function Home() {
  const identity = await headers();
  const accountId = identity.get('oai-authenticated-user-id');
  if (!accountId)
    return (
      <main className="sign-in-panel">
        <span className="brand-word">ojas.</span>
        <h1>Your health, in one place.</h1>
        <p>
          Sign in to keep your daily logs, goals, and workouts together across
          devices.
        </p>
        <Link
          className="primary-button"
          href="/signin-with-chatgpt?return_to=%2F"
          target="_top"
        >
          Sign in with ChatGPT
        </Link>
      </main>
    );
  return (
    <Dashboard
      key={accountId}
      accountId={accountId}
      accountLabel={
        identity.get('oai-authenticated-user-email') || 'Your account'
      }
      initialDay={new Date().toISOString().slice(0, 10)}
    />
  );
}
import Link from 'next/link';
