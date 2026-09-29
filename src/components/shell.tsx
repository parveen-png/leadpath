"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, Cable, LayoutDashboard, LogOut, Rows3, Settings, Users, Workflow } from "lucide-react";

import { signOut } from "@/server/actions/account";
import { cn } from "@/lib/utils";

const items = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/workflows", label: "Workflows", icon: Workflow },
  { href: "/leads", label: "Leads", icon: Users },
  { href: "/connections", label: "Connections", icon: Cable },
  { href: "/fields", label: "Field Manager", icon: Rows3 },
  { href: "/logs", label: "Activity Logs", icon: Activity },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function AppShell({
  children,
  name,
  email,
  workspace,
}: {
  children: React.ReactNode;
  name: string;
  email: string;
  workspace: string;
}) {
  const pathname = usePathname();
  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[260px_1fr]">
      <aside className="flex flex-col bg-sidebar text-stone-200 lg:min-h-screen">
        <div className="px-5 py-6">
          <p className="font-serif text-2xl text-white">Leadpath</p>
          <p className="mt-1 text-xs text-stone-400">Facebook leads, delivered clearly</p>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-3 pb-3 lg:block lg:space-y-1 lg:px-3">
          {items.map((item) => {
            const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-3 rounded-2xl px-3 py-2.5 text-sm text-stone-300 hover:bg-white/5 hover:text-white",
                  active && "nav-active text-white",
                )}
              >
                <Icon className="h-4 w-4" aria-hidden />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="mt-auto border-t border-white/10 p-4">
          <p className="text-sm font-medium text-white">{name}</p>
          <p className="truncate text-xs text-stone-400">{email}</p>
          <p className="mt-2 text-xs text-stone-500">{workspace}</p>
          <form action={signOut} className="mt-3">
            <button className="inline-flex items-center gap-2 text-sm text-stone-300 hover:text-white" type="submit">
              <LogOut className="h-4 w-4" aria-hidden />
              Logout
            </button>
          </form>
        </div>
      </aside>
      <main className="px-4 py-6 sm:px-8 sm:py-8">{children}</main>
    </div>
  );
}
