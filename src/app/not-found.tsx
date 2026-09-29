import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto max-w-lg px-6 py-24">
      <h1 className="font-serif text-4xl">That page is not here</h1>
      <p className="mt-3 text-sm text-muted">The workflow or lead may have been removed.</p>
      <Link href="/" className="mt-6 inline-block text-sm text-forest">Back to the dashboard</Link>
    </main>
  );
}
