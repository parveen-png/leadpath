import { AuthForm } from "@/features/auth/auth-form";
import { readServerEnv } from "@/lib/env";

export default function LoginPage() {
  const env = readServerEnv();
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-md space-y-4">
        {env.ok ? null : <p className="rounded-2xl bg-warn-soft px-4 py-3 text-sm text-warn">{env.message}</p>}
        <AuthForm mode="login" />
      </div>
    </main>
  );
}
