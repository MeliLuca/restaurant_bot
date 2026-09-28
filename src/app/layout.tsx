import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { Toaster } from "@/components/ui/sonner";
import { AuthGate } from "@/components/auth/auth-gate";
import { ChatListener } from "@/components/chat/chat-listener";
import { LangSync } from "@/components/layout/lang-sync";
import { DeviceRedirect } from "@/components/layout/device-redirect";
import { AppShell } from "@/components/layout/app-shell";
import { PrintQueueWatcher } from "@/components/printing/print-queue-watcher";
import "./globals.css";

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
  weight: "100 900",
});

export const metadata: Metadata = {
  title: "Trattoria RMS",
  description: "Restaurant management — floor plan, reservations, and POS",
  // Home-screen install on Android terminals. Over plain LAN HTTP, Chrome's
  // "Add to Home screen" gives a named shortcut (standalone install needs
  // HTTPS — deliberately out of scope).
  manifest: "/manifest.webmanifest",
  icons: { icon: "/icons/icon-192.png", apple: "/icons/icon-192.png" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // tablets: prevent accidental pinch-zoom while tapping quickly
  maximumScale: 1,
  userScalable: false,
  // lets the /m tab bar clear the home indicator via env(safe-area-inset-bottom)
  viewportFit: "cover",
  // the order screen pins its search bar to the bottom edge; without this the
  // Android keyboard opens straight over it
  interactiveWidget: "resizes-content",
  themeColor: "#18181b",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="it">
      <body className={`${geistSans.variable} font-sans antialiased`}>
        <LangSync />
        <DeviceRedirect />
        <AuthGate>
          <ChatListener />
          <PrintQueueWatcher />
          <AppShell>{children}</AppShell>
        </AuthGate>
        <Toaster richColors position="top-center" />
      </body>
    </html>
  );
}
