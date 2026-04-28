import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Blanket",
  description: "My personal Markov Blanket from Wikipedia",
  icons: {
    icon: '/icon.svg',
  }
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-white text-zinc-900 font-sans" style={{ WebkitFontSmoothing: "antialiased" }}>
        {children}
      </body>
    </html>
  );
}
