import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { Toaster } from "@/components/ui/sonner";
import { AuthGate } from "@/components/auth/auth-gate";
import { ChatListener } from "@/components/chat/chat-listener";
import { LangSync } from "@/components/layout/lang-sync";
import { Sidebar } from "@/components/layout/sidebar";
import "./globals.css";

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
  weight: "100 900",
});

export const metadata: Metadata = {
  title: "Trattoria RMS",
  description: "Restaurant management — floor plan, reservations, and POS",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // tablets: prevent accidental pinch-zoom while tapping quickly
  maximumScale: 1,
  userScalable: false,
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
        <AuthGate>
          <ChatListener />
          <div className="flex h-dvh overflow-hidden print:block print:h-auto print:overflow-visible">
            <Sidebar />
            <main className="flex-1 overflow-y-auto print:overflow-visible">
              {children}
            </main>
          </div>
        </AuthGate>
        <Toaster richColors position="top-center" />
      </body>
    </html>
  );
}
