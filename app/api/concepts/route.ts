import { NextRequest, NextResponse } from "next/server";
import { getConcepts, addConcept } from "@/lib/store";
import { fetchWikiConcept, parseWikiUrl, slugify } from "@/lib/wikipedia";
import { randomUUID } from "crypto";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q") ?? "";
  let concepts = getConcepts();
  if (q.trim()) {
    const lower = q.toLowerCase();
    concepts = concepts.filter(
      (c) =>
        c.title.toLowerCase().includes(lower) ||
        c.definition.toLowerCase().includes(lower)
    );
  }
  return NextResponse.json(concepts, {
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
    },
  });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const url: string = body.url ?? "";
  if (!url) return NextResponse.json({ error: "Missing URL" }, { status: 400 });

  // Pre-check by normalized URL to avoid a Wikipedia API call on obvious re-submissions
  const parsed = parseWikiUrl(url);
  if (parsed) {
    const canonicalInput = `https://${parsed.lang}.wikipedia.org/wiki/${encodeURIComponent(parsed.title.replace(/ /g, "_"))}`;
    const earlyExisting = getConcepts().find((c) => c.url === canonicalInput);
    if (earlyExisting) {
      return NextResponse.json(
        { error: "Already in your glossary", concept: earlyExisting },
        { status: 409 }
      );
    }
  }

  try {
    const wiki = await fetchWikiConcept(url);

    // Reject orphans: the new concept must share at least one edge with the glossary
    const existing = getConcepts();
    if (existing.length > 0) {
      const glossaryTitles = new Set(existing.map((c) => c.title.toLowerCase()));
      const hasOutgoing = wiki.relatedTitles.some((t) => glossaryTitles.has(t.toLowerCase()));
      const hasIncoming = existing.some((c) =>
        c.relatedTitles.some((t) => t.toLowerCase() === wiki.title.toLowerCase())
      );
      if (!hasOutgoing && !hasIncoming) {
        return NextResponse.json(
          { error: "Ce concept n'a aucune connexion avec votre glossaire. Ajoutez d'abord des concepts liés." },
          { status: 422 }
        );
      }
    }

    const { concept, created } = addConcept({
      id: randomUUID(),
      title: wiki.title,
      slug: slugify(wiki.title),
      definition: wiki.definition,
      url: wiki.url,
      thumbnail: wiki.thumbnail,
      relatedTitles: wiki.relatedTitles,
      lang: wiki.lang,
      createdAt: new Date().toISOString(),
    });
    if (!created) {
      return NextResponse.json(
        { error: "Already in your glossary", concept },
        { status: 409 }
      );
    }
    return NextResponse.json(concept, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 422 });
  }
}
