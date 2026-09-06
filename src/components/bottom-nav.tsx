"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Thumb-reachable navigation, pinned to the bottom on phones because that is
 * where a hand holding a phone actually is. Every target is at least 44px and
 * carries a visible label — icon-only navigation fails the "someone new to the
 * lab, at 11pm" test.
 */
const LINKS = [
  { href: "/", label: "Home" },
  { href: "/cages", label: "Cages" },
  { href: "/search", label: "Search" },
] as const;

export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Primary"
      className="no-print fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface/95 backdrop-blur sm:static sm:mx-auto sm:mt-8 sm:max-w-3xl sm:border-t-0"
    >
      <ul className="mx-auto flex max-w-3xl">
        {LINKS.map((link) => {
          const active =
            link.href === "/" ? pathname === "/" : pathname.startsWith(link.href);
          return (
            <li key={link.href} className="flex-1">
              <Link
                href={link.href}
                aria-current={active ? "page" : undefined}
                className={`flex min-h-14 items-center justify-center px-3 text-base font-medium transition-colors ${
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
      {/* Respects the iPhone home indicator. */}
      <div className="h-[env(safe-area-inset-bottom)] sm:hidden" />
    </nav>
  );
}
