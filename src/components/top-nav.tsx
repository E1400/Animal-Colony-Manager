"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Sticky top navigation. Every target is at least 44px and carries a visible
 * label — icon-only navigation fails the "someone new to the lab, at 11pm"
 * test.
 */
const LINKS = [
  { href: "/", label: "Home" },
  { href: "/cages", label: "Cages" },
  { href: "/scan", label: "Scan" },
  { href: "/search", label: "Search" },
  { href: "/import", label: "Import" },
  { href: "/activity", label: "Activity" },
] as const;

export function TopNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Primary"
      className="no-print sticky top-0 z-40 border-b border-border bg-surface/95 backdrop-blur"
    >
      {/* Keeps the bar clear of the notch on iOS. */}
      <div className="h-[env(safe-area-inset-top)]" />
      {/*
        Five labels do not fit across a 390px phone. Rather than drop to icons —
        which fail the "someone new to the lab at 11pm" test — the bar scrolls
        horizontally, so a label is never clipped beyond reach.
      */}
      <ul className="mx-auto flex w-full max-w-3xl overflow-x-auto px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {LINKS.map((link) => {
          const active =
            link.href === "/" ? pathname === "/" : pathname.startsWith(link.href);
          return (
            <li key={link.href} className="shrink-0">
              <Link
                href={link.href}
                aria-current={active ? "page" : undefined}
                className={`flex min-h-14 items-center whitespace-nowrap px-3 text-base font-medium transition-colors ${
                  active
                    ? "text-accent"
                    : "text-muted hover:text-foreground"
                }`}
              >
                {link.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
