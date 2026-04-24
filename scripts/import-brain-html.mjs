import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";

const ROOT = process.cwd();
const DATA_PATH = path.join(ROOT, "data", "glossary.json");
const DEFAULT_DOMAIN = "https://brain.matheo.tripnaux.com";
const WIKI_LANG = "en";
const DELAY_MS = 200;
const MAX_RETRIES = 4;
const FETCH_TIMEOUT_MS = 12000;

function slugify(title) {
  return title
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function readStore() {
  return JSON.parse(fs.readFileSync(DATA_PATH, "utf-8"));
}

function writeStore(store) {
  fs.writeFileSync(DATA_PATH, JSON.stringify(store, null, 2), "utf-8");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Blanket-Glossary/1.0" },
      signal: controller.signal,
    });
    return res;
  } finally {
    clearTimeout(timer);
  }
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

function isConceptLink(title) {
  if (title.includes(":")) return false;
  if (CITATION_SUFFIX.test(title)) return false;
  if (INFRASTRUCTURE_PAGES.has(title)) return false;
  return true;
}

async function fetchSummary(lang, title, attempt = 1) {
  const encoded = encodeURIComponent(title.replace(/ /g, "_"));
  const res = await fetchJson(
    `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encoded}`
  );

  if (!res.ok) {
    if ((res.status === 429 || res.status >= 500) && attempt <= MAX_RETRIES) {
      await sleep(1500 * attempt);
      return fetchSummary(lang, title, attempt + 1);
    }
    throw new Error(`Wikipedia summary not found for "${title}" (${res.status})`);
  }

  const data = await res.json();
  if (!data?.title || !data?.extract) {
    throw new Error(`Wikipedia summary malformed for "${title}"`);
  }

  return {
    title: data.title,
    slug: slugify(data.title),
    definition: data.extract,
    thumbnail: data.thumbnail?.source,
    url:
      data.content_urls?.desktop?.page ||
      `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(data.title.replace(/ /g, "_"))}`,
    lang,
  };
}

async function fetchRelatedTitles(lang, title, attempt = 1) {
  const links = [];
  const titleLower = title.toLowerCase();
  let plcontinue;

  do {
    const params = {
      action: "query",
      titles: title,
      prop: "links",
      pllimit: "max",
      plnamespace: "0",
      format: "json",
      origin: "*",
    };
    if (plcontinue) params.plcontinue = plcontinue;

    const res = await fetchJson(
      `https://${lang}.wikipedia.org/w/api.php?` + new URLSearchParams(params)
    );

    if (res.status === 429 || res.status >= 500) {
      if (attempt <= MAX_RETRIES) {
        await sleep(1000 * attempt);
        return fetchRelatedTitles(lang, title, attempt + 1);
      }
      break;
    }
    if (!res.ok) break;

    const data = await res.json();
    const pages = Object.values(data.query?.pages || {});
    const batch = (pages[0]?.links ?? [])
      .map((l) => l.title)
      .filter((t) => isConceptLink(t) && t.toLowerCase() !== titleLower);
    links.push(...batch);
    plcontinue = data.continue?.plcontinue;

    if (plcontinue) await sleep(DELAY_MS);
  } while (plcontinue);

  return links;
}

async function searchBestWikipediaTitle(title, lang = WIKI_LANG) {
  const params = {
    action: "query",
    list: "search",
    srsearch: title,
    srlimit: "1",
    srwhat: "text",
    format: "json",
    origin: "*",
  };

  const res = await fetchJson(
    `https://${lang}.wikipedia.org/w/api.php?` + new URLSearchParams(params)
  );
  if (!res.ok) return null;
  const data = await res.json();
  return data?.query?.search?.[0]?.title || null;
}

async function fetchWikiConceptByTitle(title, lang = WIKI_LANG) {
  try {
    const summary = await fetchSummary(lang, title);
    const relatedTitles = await fetchRelatedTitles(lang, summary.title);
    return { ...summary, relatedTitles };
  } catch {
    const bestTitle = await searchBestWikipediaTitle(title, lang);
    if (!bestTitle) {
      throw new Error(`No Wikipedia match for "${title}"`);
    }
    const summary = await fetchSummary(lang, bestTitle);
    const relatedTitles = await fetchRelatedTitles(lang, summary.title);
    return { ...summary, relatedTitles };
  }
}

function parseExplorerConceptsFromHtml(html) {
  const concepts = [];
  const seen = new Set();

  const anchorRe = /<a\s+[^>]*href="https:\/\/brain\.matheo\.tripnaux\.com\/([^"#?]+)"[^>]*>([^<]+)<\/a>/g;
  let match;

  while ((match = anchorRe.exec(html)) !== null) {
    const slug = decodeURIComponent(match[1]).trim();
    const title = match[2].replace(/\s+/g, " ").trim();

    if (!slug || !title) continue;
    if (slug === "" || slug === "index") continue;

    const key = `${slug}::${title.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);

    concepts.push({
      slug,
      title,
      definition: "",
      relatedSlugs: [],
      url: `${DEFAULT_DOMAIN}/${slug}`,
    });
  }

  return concepts;
}

function parseCurrentPageDefinition(html) {
  const titleMatch = html.match(/<h1[^>]*class="article-title"[^>]*>([^<]+)<\/h1>/i);
  const definitionMatch = html.match(/<article[^>]*>\s*<p>([\s\S]*?)<\/p>\s*<\/article>/i);
  const slugMatch = html.match(/<body[^>]*data-slug="([^"]+)"/i);

  if (!titleMatch || !definitionMatch || !slugMatch) return null;

  const title = titleMatch[1].replace(/\s+/g, " ").trim();
  const definition = definitionMatch[1]
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const slug = slugMatch[1].trim();

  if (!title || !definition || !slug) return null;

  return { title, slug, definition };
}

function getHtmlFilesFromArgsOrWorkspace() {
  const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  if (args.length > 0) {
    return args.map((p) => (path.isAbsolute(p) ? p : path.join(ROOT, p)));
  }

  return fs
    .readdirSync(ROOT, { withFileTypes: true })
    .filter((d) => d.isFile() && d.name.toLowerCase().endsWith(".html"))
    .map((d) => path.join(ROOT, d.name));
}

function main() {
  const dryRun = process.argv.includes("--dry-run");
  const htmlFiles = getHtmlFilesFromArgsOrWorkspace();

  if (htmlFiles.length === 0) {
    console.error("No HTML files found. Pass one or more files, e.g.:");
    console.error("  npm run import:brain -- ./Transcomputational\\ Algorithm.html");
    process.exit(1);
  }

  const store = readStore();
  const concepts = store.concepts ?? [];

  const bySlug = new Map(concepts.map((c) => [(c.slug || "").toLowerCase(), c]));
  const byTitle = new Map(concepts.map((c) => [(c.title || "").toLowerCase(), c]));

  const imported = [];

  for (const filePath of htmlFiles) {
    if (!fs.existsSync(filePath)) {
      console.warn(`Skipping missing file: ${filePath}`);
      continue;
    }

    const html = fs.readFileSync(filePath, "utf-8");
    const found = parseExplorerConceptsFromHtml(html);
    imported.push(...found);
  }

  const dedup = new Map();
  for (const item of imported) {
    if (!dedup.has(item.slug.toLowerCase())) {
      dedup.set(item.slug.toLowerCase(), item);
    }
  }

  const candidates = [...dedup.values()];
  const failed = [];
  let added = 0;
  let updated = 0;
  let skipped = 0;

  console.log(`HTML files scanned: ${htmlFiles.length}`);
  console.log(`Candidate concepts found: ${candidates.length}`);

  return (async () => {
    let index = 0;
    for (const item of candidates) {
      index += 1;
      process.stdout.write(`[${index}/${candidates.length}] ${item.title} ... `);
      const existing = bySlug.get(item.slug.toLowerCase()) || byTitle.get(item.title.toLowerCase());

      // Already imported via Wikipedia with a useful graph: skip
      if (
        existing &&
        existing.url?.includes("wikipedia.org/wiki/") &&
        Array.isArray(existing.relatedTitles) &&
        existing.relatedTitles.length > 0
      ) {
        skipped += 1;
        console.log("skip");
        continue;
      }

      try {
        const wiki = await fetchWikiConceptByTitle(item.title, WIKI_LANG);
        const next = {
          id: existing?.id || randomUUID(),
          title: wiki.title,
          slug: wiki.slug,
          definition: wiki.definition,
          url: wiki.url,
          thumbnail: wiki.thumbnail,
          relatedTitles: wiki.relatedTitles,
          lang: wiki.lang,
          createdAt: existing?.createdAt || new Date().toISOString(),
        };

        if (existing) {
          const idx = store.concepts.findIndex((c) => c.id === existing.id);
          if (idx >= 0) {
            store.concepts[idx] = next;
            updated += 1;
            console.log("updated");
          }
        } else {
          store.concepts.push(next);
          added += 1;
          console.log("added");
        }

        if (!dryRun) {
          writeStore(store);
        }

        // refresh maps after potential slug/title normalization from wikipedia
        bySlug.set(next.slug.toLowerCase(), next);
        byTitle.set(next.title.toLowerCase(), next);
      } catch (err) {
        failed.push({ title: item.title, slug: item.slug, reason: err.message || String(err) });
        console.log("failed");
      }

      await sleep(DELAY_MS);
    }

    console.log(`Added: ${added}`);
    console.log(`Updated: ${updated}`);
    console.log(`Skipped (already ok): ${skipped}`);
    console.log(`Failed: ${failed.length}`);

    if (!dryRun) {
      console.log("Glossary updated.");
    } else {
      console.log("Dry run mode: no file changes.");
    }

    if (failed.length > 0) {
      console.log("\nConcepts not imported via Wikipedia:");
      for (const f of failed) {
        console.log(` - ${f.title} (${f.slug}) :: ${f.reason}`);
      }
    }
  })();
}

await main();
