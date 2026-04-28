import { getConceptBySlug, getConcepts } from "@/lib/store";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ExternalLink } from "lucide-react";

export default function ConceptPage({ params }: { params: { slug: string } }) {
  const concept = getConceptBySlug(params.slug);
  if (!concept) notFound();

  const allConcepts = getConcepts();
  const relatedInGlossary = allConcepts.filter((c) =>
    concept.relatedTitles.some(
      (t) => t.toLowerCase() === c.title.toLowerCase()
    )
  );

  return (
    <div className="animate-fade-in space-y-10">
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-zinc-400 hover:text-zinc-700 transition-colors"
          >
            <ArrowLeft className="size-3" />
            Glossary
          </Link>
          <div className="flex items-center gap-3">
            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-md bg-zinc-100 text-zinc-500 uppercase tracking-wide">
              {concept.lang}
            </span>
            <a
              href={concept.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-700 transition-colors"
            >
              Wikipedia
              <ExternalLink className="size-3" />
            </a>
          </div>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">
          {concept.title}
        </h1>
      </div>

      <section className="space-y-2">
        <h2 className="text-xs font-medium uppercase tracking-widest text-zinc-400">
          Definition
        </h2>
        <p className="text-sm leading-7 text-zinc-700 whitespace-pre-wrap">
          {concept.definition}
        </p>
      </section>

      {concept.relatedTitles.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-xs font-medium uppercase tracking-widest text-zinc-400">
            Related concepts
          </h2>
          <div className="flex flex-wrap gap-2">
            {concept.relatedTitles.map((title) => {
              const linked = relatedInGlossary.find(
                (c) => c.title.toLowerCase() === title.toLowerCase()
              );
              return linked ? (
                <Link
                  key={title}
                  href={`/concept/${linked.slug}`}
                  className="rounded-full border border-zinc-900 bg-white px-3 py-1 text-xs font-medium text-zinc-900 hover:bg-zinc-900 hover:text-white transition-colors"
                >
                  {title}
                </Link>
              ) : (
                <a
                  key={title}
                  href={`https://${concept.lang}.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-full border border-zinc-200 px-3 py-1 text-xs text-zinc-500 hover:border-zinc-400 hover:text-zinc-700 transition-colors"
                >
                  {title}
                </a>
              );
            })}
          </div>
          {relatedInGlossary.length > 0 && (
            <p className="text-xs text-zinc-400">
              <span className="font-medium text-zinc-600">{relatedInGlossary.length}</span>{" "}
              concept{relatedInGlossary.length > 1 ? "s" : ""} already in your glossary
            </p>
          )}
        </section>
      )}
    </div>
  );
}
