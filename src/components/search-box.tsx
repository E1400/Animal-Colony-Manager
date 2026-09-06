"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * One box for cage codes, rack addresses and ear tags. Deliberately not a
 * dropdown of "search type" — at a rack, you type what is printed in front of
 * you and the app works out what it is.
 */
export function SearchBox({
  defaultValue = "",
  autoFocus = false,
}: {
  defaultValue?: string;
  autoFocus?: boolean;
}) {
  const router = useRouter();
  const [value, setValue] = useState(defaultValue);

  return (
    <form
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        const q = value.trim();
        if (q) router.push(`/search?q=${encodeURIComponent(q)}`);
      }}
      className="flex gap-2"
    >
      <label htmlFor="colony-search" className="sr-only">
        Search by cage code, rack slot, or ear tag
      </label>
      <input
        id="colony-search"
        name="q"
        type="search"
        // Numeric-friendly without forcing it: ear tags are digits, cage codes
        // are not.
        inputMode="search"
        autoComplete="off"
        autoFocus={autoFocus}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Cage, slot, or ear tag"
        className="min-h-14 flex-1 rounded-xl border border-border bg-surface px-4 text-lg placeholder:text-muted"
      />
      <button
        type="submit"
        className="min-h-14 rounded-xl bg-accent px-5 text-lg font-semibold text-accent-contrast"
      >
        Go
      </button>
    </form>
  );
}
