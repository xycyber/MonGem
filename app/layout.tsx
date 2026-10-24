import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Providers } from "@/app/providers";
import { SiteHeader } from "@/components/site-header";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "MonGem · Mini game on-chain di Monad",
  description:
    "MonGem: platform mini game on-chain di Monad. Game klasik, turnamen on-chain, hadiah langsung cair. Game pertama: Ludo.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="id"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col bg-[#0d0a1c] text-violet-50">
        <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(ellipse_at_top,rgba(139,92,246,0.18),transparent_60%)]" />
        <Providers>
          <SiteHeader />
          <div className="relative flex flex-1 flex-col">{children}</div>
        </Providers>
      </body>
    </html>
  );
}
