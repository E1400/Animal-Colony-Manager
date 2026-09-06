"use client";

export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="no-print min-h-12 rounded-xl bg-accent px-5 font-semibold text-accent-contrast"
    >
      Print
    </button>
  );
}
