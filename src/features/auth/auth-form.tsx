"use client";

import Link from "next/link";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { signIn, signUp } from "@/server/actions/account";

export function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const [message, setMessage] = useState<string | null>(null);
  return (
    <Card className="w-full max-w-md space-y-4">
      <div>
        <p className="font-serif text-3xl">Leadpath</p>
        <h1 className="mt-2 text-lg">{mode === "login" ? "Sign in" : "Create your workspace"}</h1>
        <p className="text-sm text-muted">Facebook leads, mapped and delivered to Follow Up Boss.</p>
      </div>
      <form
        className="space-y-3"
        action={async (formData) => {
          const result = mode === "login" ? await signIn(formData) : await signUp(formData);
          if (result && "error" in result && result.error) setMessage(result.error);
          if (result && "message" in result && result.message) setMessage(result.message);
        }}
      >
        {mode === "signup" ? (
          <>
            <Input name="fullName" placeholder="Your name" aria-label="Your name" required />
            <Input name="workspaceName" placeholder="Workspace name" aria-label="Workspace name" required />
          </>
        ) : null}
        <Input name="email" type="email" placeholder="Email" aria-label="Email" required />
        <Input name="password" type="password" placeholder="Password" aria-label="Password" required minLength={8} />
        <Button type="submit" className="w-full">{mode === "login" ? "Sign in" : "Create account"}</Button>
      </form>
      {message ? <p className="text-sm">{message}</p> : null}
      <p className="text-sm text-muted">
        {mode === "login" ? <Link href="/signup">Create a workspace</Link> : <Link href="/login">Already have an account? Sign in</Link>}
      </p>
    </Card>
  );
}
