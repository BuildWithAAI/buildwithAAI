import type { Metadata } from "next";
import { headers } from "next/headers";
import { clientAddress } from "../auth/owner";
import { allowPublicRequest } from "../auth/public";
import { publicModeOn } from "../auth/publicMode";
import { Nav } from "../components/Nav";
import { getEngine } from "../server/engine";
import "./globals.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Zoora",
  description: "A bioluminescent jellyfish living in the Glass Bowl.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  let limited = false;
  if (publicModeOn()) {
    const header = await headers();
    const ip = clientAddress((name) => header.get(name), process.env.LUMEN_TRUSTED_PROXY, true);
    limited = !allowPublicRequest(getEngine().db, ip);
  }
  return (
    <html lang="en">
      <body>
        <Nav showKeeper={!publicModeOn()} />
        <main className="wrap">{limited ? <p>Too many requests. Wait a minute and try again.</p> : children}</main>
      </body>
    </html>
  );
}
