import { cn } from "@/lib/utils";

const tones = {
  neutral: "bg-stone-100 text-stone-700",
  good: "bg-forest-soft text-forest",
  bad: "bg-danger-soft text-danger",
  warn: "bg-warn-soft text-warn",
  draft: "bg-stone-100 text-stone-600",
};

export function Badge({
  children,
  tone = "neutral",
  className,
}: {
  children: React.ReactNode;
  tone?: keyof typeof tones;
  className?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium", tones[tone], className)}>
      {children}
    </span>
  );
}

export function statusTone(status: string): keyof typeof tones {
  if (["connected", "active", "delivered"].includes(status)) return "good";
  if (["failed", "error", "disconnected"].includes(status)) return "bad";
  if (["retrying", "delivered_with_warning", "paused"].includes(status)) return "warn";
  return "draft";
}

export function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    delivered_with_warning: "Delivered with warning",
    not_connected: "Not connected",
    disconnected: "Not connected",
  };
  return labels[status] ?? status.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}
