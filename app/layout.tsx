import type { Metadata } from "next";
import "./globals.css";
import { getConcepts } from "@/lib/store";

export const metadata: Metadata = {
  title: "Blanket — Glossary",
  description: "Build your personal glossary from Wikipedia",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const count = getConcepts().length;
  return (
    <html lang="en">
      <body className="min-h-screen bg-white text-zinc-900 font-sans">
        <div className="max-w-2xl mx-auto px-4 py-12">
          <header className="mb-10 flex items-center justify-between">
            <a href="/" className="flex items-center gap-2 group w-fit">
              <span className="text-xl font-semibold tracking-tight">blanket</span>
              <span className="text-zinc-400 text-sm font-normal mt-0.5">glossary</span>
            </a>
            {count > 0 && (
              <span className="text-sm tabular-nums text-zinc-400">
                {count} concept{count !== 1 ? "s" : ""}
              </span>
            )}
          </header>
          <main>{children}</main>
        </div>
      </body>
    </html>
  );
}
