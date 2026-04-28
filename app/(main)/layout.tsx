import ConceptCount from "@/components/ConceptCount";

export default function MainLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="max-w-2xl mx-auto px-4 py-4 md:py-12">
      <header className="mb-10 flex items-center justify-between">
        <a href="/" className="flex items-center gap-2 w-fit">
          <span className="text-xl font-semibold tracking-tight">blanket</span>
          <span className="text-zinc-400 text-sm font-normal mt-0.5">glossary</span>
        </a>
        <ConceptCount />
      </header>
      <main>{children}</main>
    </div>
  );
}
