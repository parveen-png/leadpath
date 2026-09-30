import { AppShell } from "@/components/shell";
import { readServerEnv } from "@/lib/env";
import { DatabaseNotReady, requireWorkspace } from "@/server/session";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const env = readServerEnv();
  if (!env.ok) {
    return (
      <main className="mx-auto max-w-xl px-6 py-20">
        <h1 className="font-serif text-4xl">Leadpath needs a few settings</h1>
        <p className="mt-4 text-sm leading-6 text-muted">{env.message}</p>
      </main>
    );
  }
  try {
    const ctx = await requireWorkspace();
    return (
      <AppShell name={ctx.fullName} email={ctx.email} workspace={ctx.workspaceName}>
        {children}
      </AppShell>
    );
  } catch (error) {
    if (!(error instanceof DatabaseNotReady)) throw error;
    return (
      <AppShell name="Team Arora" email="" workspace="Team Arora">
        <h1 className="font-serif text-4xl">Database not ready</h1>
        <p className="mt-4 max-w-xl text-sm leading-6 text-muted">{error.message}</p>
      </AppShell>
    );
  }
}
