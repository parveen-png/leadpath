import { cn } from "@/lib/utils";

export function Card({ className, children }: { className?: string; children: React.ReactNode }) {
  return <section className={cn("rounded-3xl border border-line bg-card p-5 shadow-[0_1px_0_rgba(28,25,23,0.03)]", className)}>{children}</section>;
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={cn(
        "h-11 w-full rounded-2xl border border-line bg-white px-3 text-sm outline-none placeholder:text-stone-400",
        props.className,
      )}
    />
  );
}

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={cn("min-h-24 w-full rounded-2xl border border-line bg-white px-3 py-2 text-sm outline-none", props.className)}
    />
  );
}

export function Label({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return (
    <label className="block space-y-1.5 text-sm">
      <span className="font-medium">{children}</span>
      {hint ? <span className="block text-xs leading-5 text-muted">{hint}</span> : null}
    </label>
  );
}
