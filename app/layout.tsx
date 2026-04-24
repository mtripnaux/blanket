import type { Metadata } from "next";
import "./globals.css";
import ConceptCount from "@/components/ConceptCount";

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
      <body className="min-h-screen bg-white text-zinc-900 font-sans">
        <div className="max-w-2xl mx-auto px-4 py-12">
          <header className="mb-10 flex items-center justify-between">
            <a href="/" className="flex items-center gap-2 group w-fit">
              <span className="text-xl font-semibold tracking-tight">blanket</span>
              <span className="text-zinc-400 text-sm font-normal mt-0.5">glossary</span>
            </a>
            <ConceptCount />
          </header>
          <main>{children}</main>
        </div>
      </body>
    </html>
  );
}
