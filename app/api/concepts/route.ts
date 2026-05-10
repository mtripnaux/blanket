import { NextRequest, NextResponse } from "next/server";
import { getConcepts, addConcept } from "@/lib/store";
import { fetchWikiConcept, parseWikiUrl, slugify } from "@/lib/wikipedia";
import { randomUUID } from "crypto";

const SLIM_DEFINITION_LENGTH = 200;

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q") ?? "";
  const slim = req.nextUrl.searchParams.get("slim") === "1";
  const limitParam = req.nextUrl.searchParams.get("limit");
  const limit = limitParam ? Math.max(1, parseInt(limitParam, 10)) : null;

  let concepts = getConcepts();
  if (q.trim()) {
    const lower = q.toLowerCase();
    concepts = concepts.filter(
      (c) =>
        c.title.toLowerCase().includes(lower) ||
        c.definition.toLowerCase().includes(lower)
    );
  }
  if (limit) concepts = concepts.slice(0, limit);

  const payload = slim
    ? concepts.map(({ id, slug, title, definition, thumbnail, lang, relatedTitles }) => ({
        id,
        slug,
        title,
        definition: definition.length > SLIM_DEFINITION_LENGTH ? definition.slice(0, SLIM_DEFINITION_LENGTH) : definition,
        thumbnail,
        lang,
        linkCount: relatedTitles.length,
      }))
    : concepts;
  return NextResponse.json(payload, {
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
