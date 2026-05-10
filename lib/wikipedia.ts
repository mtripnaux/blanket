export type WikiSummary = {
  title: string;
  slug: string;
  definition: string;
  thumbnail?: string;
  url: string;
  lang: string;
};

export type WikiResult = WikiSummary & {
  relatedTitles: string[];
};

export function parseWikiUrl(url: string): { lang: string; title: string } | null {
  try {
    const u = new URL(url);
    const match = u.hostname.match(/^([a-z-]+)\.wikipedia\.org$/);
    if (!match) return null;
    const lang = match[1];
    const title = decodeURIComponent(u.pathname.replace(/^\/wiki\//, "")).replace(/_/g, " ");
    if (!title) return null;
    return { lang, title };
  } catch {
    return null;
  }
}

export function slugify(title: string): string {
  return title
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

async function fetchSummary(lang: string, title: string, attempt = 1): Promise<WikiSummary> {
  const encoded = encodeURIComponent(title.replace(/ /g, "_"));
  const res = await fetch(
    `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encoded}`,
    { headers: { "User-Agent": "Blanket-Glossary/1.0" } }
  );
  if (!res.ok) {
    if ((res.status === 429 || res.status >= 500) && attempt <= 4) {
      await new Promise((r) => setTimeout(r, 2000 * attempt));
      return fetchSummary(lang, title, attempt + 1);
    }
    throw new Error(`Wikipedia article not found: "${title}" (${res.status})`);
  }
  const data = await res.json();
  return {
    title: data.title,
    slug: slugify(data.title),
    definition: data.extract || "",
    thumbnail: data.thumbnail?.source,
    url: data.content_urls?.desktop?.page || `https://${lang}.wikipedia.org/wiki/${encoded}`,
    lang,
  };
}

const CITATION_SUFFIX = / \(identifier\)$/i;
const INFRASTRUCTURE_PAGES = new Set([
  "Wayback Machine", "Virtual International Authority File",
  "Library of Congress Control Number", "National Library of France",
  "Integrated Authority File", "Biblioteca Nacional de España",
  "Bibliothèque nationale de France", "WorldCat",
  "PubMed", "PubMed Central", "Digital object identifier",
  "International Standard Book Number", "International Standard Serial Number",
]);

function isConceptLink(title: string): boolean {
  if (title.includes(":")) return false;
  if (CITATION_SUFFIX.test(title)) return false;
  if (INFRASTRUCTURE_PAGES.has(title)) return false;
  return true;
}

async function fetchRelatedTitles(lang: string, title: string): Promise<string[]> {
  const links: string[] = [];
  const titleLower = title.toLowerCase();
  let plcontinue: string | undefined;

  do {
    const params: Record<string, string> = {
      action: "query",
      titles: title,
      prop: "links",
      pllimit: "max",
      plnamespace: "0",
      format: "json",
      origin: "*",
    };
    if (plcontinue) params.plcontinue = plcontinue;

    let res: Response | undefined;
    for (let attempt = 1; attempt <= 4; attempt++) {
      res = await fetch(
        `https://${lang}.wikipedia.org/w/api.php?` + new URLSearchParams(params),
        { headers: { "User-Agent": "Blanket-Glossary/1.0" } }
      );
      if (res.ok || (res.status !== 429 && res.status < 500)) break;
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
    if (!res || !res.ok) break;

    const data = await res.json();
    const pages = Object.values(data.query?.pages || {}) as any[];
    const batch: string[] = pages[0]?.links?.map((l: any) => l.title) ?? [];
    links.push(
      ...batch.filter((t) => isConceptLink(t) && t.toLowerCase() !== titleLower)
    );
    plcontinue = data.continue?.plcontinue;
  } while (plcontinue);

  return links;
}

export async function fetchWikiConcept(url: string): Promise<WikiResult> {
  const parsed = parseWikiUrl(url);
  if (!parsed) throw new Error("Invalid Wikipedia URL");
  const [summary, relatedTitles] = await Promise.all([
    fetchSummary(parsed.lang, parsed.title),
    fetchRelatedTitles(parsed.lang, parsed.title),
  ]);
  return { ...summary, relatedTitles };
}
