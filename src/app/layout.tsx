import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import { SessionBar } from "@/components/session-bar";
import { TopNav } from "@/components/top-nav";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Colony",
  description: "Mobile-first colony management for a research vivarium.",
};

export const viewport: Viewport = {
  // No maximum-scale: pinch-zoom must keep working. Blocking it is an
  // accessibility failure, and this app is used at arm's length.
  width: "device-width",
  initialScale: 1,
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
    >
      <body className="min-h-full bg-background text-foreground">
        <a
          href="#main"
          className="no-print sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-accent focus:px-4 focus:py-3 focus:text-accent-contrast"
        >
          Skip to content
        </a>
        <TopNav />
        <SessionBar />
        <main id="main" className="mx-auto w-full max-w-3xl px-4 pb-10 pt-5">
          {children}
        </main>
      </body>
    </html>
  );
}
