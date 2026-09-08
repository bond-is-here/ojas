'use client';
import Link from 'next/link';
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="sign-in-panel" role="alert">
      <span className="wordmark">
        ojas<span>.</span>
      </span>
      <h1>Let’s try that again.</h1>
      <p>
        Ojas could not load this view. Your saved account data is still there.
      </p>
      <button className="primary-button" onClick={reset}>
        Try again
      </button>
      <Link className="text-link" href="/">
        Return to today
      </Link>
    </main>
  );
}
