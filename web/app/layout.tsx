import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import AppShell from "./components/AppShell";
import { ThemeProvider } from "./components/ThemeProvider";
import GlobalToastProvider from "./components/GlobalToastProvider";
import { MusicPlayerProvider } from "./components/MusicPlayerProvider";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Mengnex",
  description: "本地优先的个人媒体资料库",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="zh-CN"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="h-full overflow-hidden">
        <ThemeProvider>
          <MusicPlayerProvider>
            <AppShell>{children}</AppShell>
            <GlobalToastProvider />
          </MusicPlayerProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
