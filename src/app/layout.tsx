import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://agreeaway.com"),
  applicationName: "AgreeAway",
  alternates: { canonical: "/" },
  title: {
    default: "AgreeAway — Plans that go somewhere",
    template: "%s | AgreeAway",
  },
  description:
    "Turn an idea into a plan you can shape, share, and actually use.",
  openGraph: {
    title: "AgreeAway — Plans that go somewhere",
    description:
      "A thoughtful, organized plan built around your dates, budget, people, and priorities.",
    url: "https://agreeaway.com",
    siteName: "AgreeAway",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "AgreeAway — Plans that go somewhere",
    description: "Turn an idea into a plan you can shape, share, and actually use.",
  },
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" className="h-full scroll-smooth antialiased" data-scroll-behavior="smooth">
      <body className="min-h-full">{children}</body>
    </html>
  );
}
