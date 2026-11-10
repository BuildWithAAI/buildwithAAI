import type { Metadata } from "next";
import { publicModeOn } from "../auth/publicMode";
import { Nav } from "../components/Nav";
import "./globals.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Zoora",
  description: "A bioluminescent jellyfish living in the Glass Bowl.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Nav showKeeper={!publicModeOn()} />
        <main className="wrap">{children}</main>
      </body>
    </html>
  );
}
