export default function Loading() {
  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="h-10 w-48 animate-pulse rounded-2xl bg-white" />
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="h-32 animate-pulse rounded-3xl bg-white" />
        <div className="h-32 animate-pulse rounded-3xl bg-white" />
      </div>
    </div>
  );
}
