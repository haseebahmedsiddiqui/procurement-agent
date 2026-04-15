"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Anchor,
  Upload,
  History,
  BookOpen,
  Settings,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { VendorStatusBar } from "./vendor-status-bar";

const navItems = [
  { href: "/", label: "Upload RFQ", icon: Upload },
  { href: "/history", label: "History", icon: History },
  { href: "/dictionary", label: "Dictionary", icon: BookOpen },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container flex h-14 items-center">
          <Link href="/" className="mr-8 flex items-center gap-2.5 group">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground transition-transform group-hover:scale-105">
              <Anchor className="h-4.5 w-4.5" />
            </div>
            <div className="flex flex-col">
              <span className="text-sm font-bold leading-none tracking-tight">
                Procurement Agent
              </span>
              <span className="text-[10px] text-muted-foreground leading-tight">
                Maritime Price Comparison
              </span>
            </div>
          </Link>
          <nav className="flex flex-1 items-center gap-1">
            {navItems.map((item) => {
              const isActive =
                item.href === "/"
                  ? pathname === "/"
                  : pathname.startsWith(item.href);
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                    isActive
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {item.label}
                </Link>
              );
            })}
          </nav>
          <VendorStatusBar />
        </div>
      </header>
      <main className="container flex-1 py-6">{children}</main>
    </div>
  );
}
