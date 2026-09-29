import { AuthForm } from "@/features/auth/auth-form";

export default function SignupPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <AuthForm mode="signup" />
    </main>
  );
}
