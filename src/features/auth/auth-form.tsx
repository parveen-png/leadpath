"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { signIn } from "@/server/actions/account";

export function AuthForm() {
  const [message, setMessage] = useState<string | null>(null);
  return (
    <Card className="w-full max-w-md space-y-4">
      <div>
        <p className="font-serif text-3xl">Leadpath</p>
        <h1 className="mt-2 text-lg">Enter the passcode</h1>
        <p className="text-sm text-muted">Facebook leads, mapped and delivered to Follow Up Boss.</p>
      </div>
      <form
        className="space-y-3"
        action={async (formData) => {
          const result = await signIn(formData);
          if (result && "error" in result && result.error) setMessage(result.error);
        }}
      >
        <Input name="passcode" type="password" placeholder="Passcode" aria-label="Passcode" required autoComplete="current-password" />
        <Button type="submit" className="w-full">Continue</Button>
      </form>
      {message ? <p className="text-sm">{message}</p> : null}
    </Card>
  );
}
