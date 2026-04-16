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
      <header className="sticky top-0 z-50 border-b border-border/60 bg-background/80 backdrop-blur-xl supports-[backdrop-filter]:bg-background/60">
        <div className="container flex h-16 items-center">
          <Link href="/" className="mr-10 flex items-center gap-3 group">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary shadow-sm shadow-primary/25 text-primary-foreground transition-all group-hover:shadow-md group-hover:shadow-primary/30 group-hover:scale-105">
              <Anchor className="h-[18px] w-[18px]" />
            </div>
            <div className="flex flex-col">
              <span className="text-[15px] font-semibold leading-none tracking-tight font-[family-name:var(--font-heading)]">
                Procurement Agent
              </span>
              <span className="text-[11px] text-muted-foreground leading-tight mt-0.5">
                Maritime Price Comparison
              </span>
            </div>
          </Link>
          <nav className="flex flex-1 items-center gap-0.5">
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
                    "relative flex items-center gap-2 rounded-lg px-3.5 py-2 text-[13px] font-medium transition-all duration-200",
                    isActive
                      ? "text-primary bg-primary/[0.08]"
                      : "text-muted-foreground hover:text-foreground hover:bg-accent"
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {item.label}
                  {isActive && (
                    <span className="absolute -bottom-[9px] left-3 right-3 h-[2px] rounded-full bg-primary" />
                  )}
                </Link>
              );
            })}
          </nav>
          <VendorStatusBar />
        </div>
      </header>
      <main className="container flex-1 py-8 animate-fade-in-up">{children}</main>
    </div>
  );
}
