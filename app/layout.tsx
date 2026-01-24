import type { Metadata } from "next";
import "./globals.css";
import { Header } from "@/components/Header";
import { ThemeProvider } from "next-themes";
import AuthProfileSync from "@/components/AuthProfileSync";

export const metadata: Metadata = {
  title: "AAST Events",
  description: "Discover events at AAST",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          <Header />
          <AuthProfileSync />
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
