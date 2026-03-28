import type { Metadata } from "next";
import { Space_Grotesk, Source_Sans_3 } from "next/font/google";

import { SiteHeader } from "@/components/site-header";
import "./globals.css";

const headingFont = Space_Grotesk({
  variable: "--font-heading",
  subsets: ["latin"],
});

const bodyFont = Source_Sans_3({
  variable: "--font-body",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Niural Careers",
  description: "Explore open roles, submit an application, and track your status.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${headingFont.variable} ${bodyFont.variable} h-full antialiased`}
    >
      <body suppressHydrationWarning className="min-h-full bg-[var(--page-bg)] text-[var(--ink)]">
        <div className="mx-auto flex min-h-screen w-full max-w-7xl flex-col px-4 py-5 sm:px-6 lg:px-8">
          <SiteHeader />
          <main className="flex-1 pb-10">{children}</main>
        </div>
      </body>
    </html>
  );
}
