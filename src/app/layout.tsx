import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Pocket Signal Lab",
    template: "%s · Pocket Signal Lab",
  },
  description:
    "Analyse trading chat and signal exports you already have access to. Win rates, sentiment, and performance breakdowns from your own data.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#070b14",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-dvh bg-abyss text-ink antialiased">{children}</body>
    </html>
  );
}
