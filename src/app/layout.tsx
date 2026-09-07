import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import { SessionBar } from "@/components/session-bar";
import { THEME_INIT_SCRIPT, ThemeToggle } from "@/components/theme-toggle";
import { TopNav } from "@/components/top-nav";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Colony",
  description: "Mobile-first colony management for a research vivarium.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Pinching *in* stays available — blocking it fails WCAG 1.4.4, and this app
  // is read at arm's length. Pinching *out* below 100% is what needed
  // stopping: the import grid is deliberately wider than a phone, and iOS
  // treats that as licence to shrink the whole interface to fit it, which
  // leaves the page unusably small with no obvious way back.
  minimumScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#09090b" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        {/* Applies the stored theme before first paint, so the page never
            flashes the wrong colours on its way to the right ones. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-full bg-background text-foreground">
        <a
          href="#main"
          className="no-print sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-accent focus:px-4 focus:py-3 focus:text-accent-contrast"
        >
          Skip to content
        </a>
        <TopNav
          account={
            <>
              <ThemeToggle />
              <SessionBar />
            </>
          }
        />
        <main id="main" className="mx-auto w-full max-w-3xl px-4 pb-10 pt-5">
          {children}
        </main>
      </body>
    </html>
  );
}
