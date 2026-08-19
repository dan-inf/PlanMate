import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://myplanmate.app"),
  title: {
    default: "PlanMate — Plans that go somewhere",
    template: "%s | PlanMate",
  },
  description:
    "Tell PlanMate what you’re trying to do. Get a thoughtful, organized plan you can shape, share, and actually use.",
  openGraph: {
    title: "PlanMate — Plans that go somewhere",
    description:
      "A thoughtful, organized plan built around your dates, budget, people, and priorities.",
    url: "https://myplanmate.app",
    siteName: "PlanMate",
    type: "website",
  },
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" className="h-full scroll-smooth antialiased" data-scroll-behavior="smooth">
      <body className="min-h-full">{children}</body>
    </html>
  );
}
