import React from "react";
import type { Metadata } from "next";
import { publicModeOn } from "../auth/publicMode";
import { moneyLive } from "../money/rules";
import { AiNotice } from "../components/AiNotice";
import { Nav } from "../components/Nav";
import { SiteFooter } from "../components/SiteFooter";
import "./globals.css";

export const dynamic = "force-dynamic";

const DESCRIPTION = "Zoora is building tools for people and AI agents to work together. Sign up for product and build updates.";

export const metadata: Metadata = {
  metadataBase: new URL("https://zoora.ai"),
  title: "Zoora",
  description: DESCRIPTION,
  alternates: { canonical: "./" },
  icons: { icon: "/favicon.svg" },
  openGraph: {
    title: "Zoora",
    description: DESCRIPTION,
    url: "https://zoora.ai/",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "Zoora",
    description: DESCRIPTION,
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AiNotice />
        <Nav showKeeper={!publicModeOn()} showMoney={moneyLive()} />
        <main className="wrap">{children}</main>
        <SiteFooter />
      </body>
    </html>
  );
}
