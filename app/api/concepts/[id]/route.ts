import { NextRequest, NextResponse } from "next/server";
import { deleteConcept, getConceptById, updateConcept } from "@/lib/store";
import { fetchWikiConcept, slugify } from "@/lib/wikipedia";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const deleted = deleteConcept(params.id);
  if (!deleted) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const current = getConceptById(params.id);
  if (!current) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const url: string = body.url || current.url;
    const wiki = await fetchWikiConcept(url);

    const updated = updateConcept(current.id, {
      ...current,
      title: wiki.title,
      slug: slugify(wiki.title),
      definition: wiki.definition,
      url: wiki.url,
      thumbnail: wiki.thumbnail,
      relatedTitles: wiki.relatedTitles,
      lang: wiki.lang,
    });

    if (!updated) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    return NextResponse.json(updated);
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Could not refresh concept" }, { status: 422 });
  }
}
