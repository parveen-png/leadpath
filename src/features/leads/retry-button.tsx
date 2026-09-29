"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { retryLead } from "@/server/actions/workflows";

export function RetryButton({ leadId }: { leadId: string }) {
  const [message, setMessage] = useState<string | null>(null);
  return (
    <div>
      <Button
        type="button"
        onClick={async () => {
          const result = await retryLead(leadId);
          setMessage(result.ok ? "Delivery queued again." : result.error);
        }}
      >
        Retry Delivery
      </Button>
      {message ? <p className="mt-2 text-sm">{message}</p> : null}
    </div>
  );
}
