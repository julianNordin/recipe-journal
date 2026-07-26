import type { Metadata } from "next";

import { SITE_ORIGIN } from "@/server/site";
import { Fraunces, Inter } from "next/font/google";

import { SiteFooter } from "@/components/layout/SiteFooter";
import { SiteHeader } from "@/components/layout/SiteHeader";

import "./globals.css";

/*
 * next/font self-hosts these at build time. No request to fonts.gstatic.com at
 * runtime, so no third-party connection and no layout shift waiting on one.
 */
const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});

const fraunces = Fraunces({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-fraunces",
  axes: ["SOFT", "WONK"],
});

export const metadata: Metadata = {
  /*
   * **Every absolute URL in the site's metadata is built from this**, and
   * without it Next falls back to `localhost:3000` -- so `og:image` on a
   * production page would point at a development port, and the picture a link
   * preview fetches would not exist.
   *
   * It is invisible until somebody pastes a link somewhere: the page renders
   * perfectly, the tag is present, and the URL in it is wrong. The end-to-end
   * test that follows `og:image` and fetches it is what found this, which is
   * the argument for following the URL rather than asserting the tag exists.
   *
   * `SITE_ORIGIN` is the same value the sitemap and the feed use, so all three
   * agree by construction.
   */
  metadataBase: new URL(SITE_ORIGIN),
  title: {
    default: "Recipe Journal",
    template: "%s · Recipe Journal",
  },
  description: "A small recipe site with authoring and authentication, rendered on the server.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${inter.variable} ${fraunces.variable}`}>
      <body>
        <a href="#main" className="skip-link">
          Skip to content
        </a>
        <SiteHeader />
        <main id="main">{children}</main>
        <SiteFooter />
      </body>
    </html>
  );
}
