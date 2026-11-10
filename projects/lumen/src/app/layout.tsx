import React from "react";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { publicModeOn } from "../auth/publicMode";
import { moneyLive } from "../money/rules";
import { AiNotice } from "../components/AiNotice";
import { HydrationMark } from "../components/HydrationMark";
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

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const nonce = (await headers()).get("x-nonce") ?? "";
  const immersive = (await headers()).get("x-lumen-path") === "/";
  return (
    <html lang="en" data-csp={nonce ? "nonce" : "open"}>
      <body className={immersive ? "immersive" : undefined}>
        <HydrationMark />
        <AiNotice />
        {immersive ? null : <Nav showKeeper={!publicModeOn()} showMoney={moneyLive()} />}
        <main className={immersive ? "home-main" : "wrap"}>{children}</main>
        {immersive ? null : <SiteFooter />}
      </body>
    </html>
  );
}
