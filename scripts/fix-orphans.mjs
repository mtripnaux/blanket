/**
 * Finds concepts with no graph connections and attempts to fix them by
 * re-fetching their Wikipedia links. Concepts with links but no glossary
 * overlap are reported but cannot be fixed automatically.
 *
 * Usage:  node scripts/fix-orphans.mjs [--dry-run]
 */

import fs from "fs";
import path from "path";

const ROOT = process.cwd();
const DATA_PATH = path.join(ROOT, "data", "glossary.json");
const DELAY_MS = 350;
const MAX_RETRIES = 4;

function readStore() {
  return JSON.parse(fs.readFileSync(DATA_PATH, "utf-8"));
}

function writeStore(store) {
  fs.writeFileSync(DATA_PATH, JSON.stringify(store, null, 2), "utf-8");
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
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
        await sleep(1500 * attempt);
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

/** Returns true if concept has at least one edge to/from another concept in the glossary */
function isConnected(concept, glossaryTitles) {
  const titleLower = concept.title.toLowerCase();
  // outgoing: this concept links to someone in glossary
  if (concept.relatedTitles.some((t) => glossaryTitles.has(t.toLowerCase()))) return true;
  // incoming: handled outside (caller checks separately)
  return false;
}

const dryRun = process.argv.includes("--dry-run");
const store = readStore();
const concepts = store.concepts ?? [];

if (concepts.length === 0) {
  console.log("Glossary is empty, nothing to fix.");
  process.exit(0);
}

const glossaryTitles = new Set(concepts.map((c) => c.title.toLowerCase()));

// Build incoming edge map: title → true if any other concept links to it
const hasIncoming = new Set();
for (const c of concepts) {
  for (const t of c.relatedTitles) {
    if (glossaryTitles.has(t.toLowerCase())) hasIncoming.add(t.toLowerCase());
  }
}

// Classify orphans
const noLinks = [];       // relatedTitles is empty → can re-fetch
const truelyIsolated = []; // has links but none in glossary → can't auto-fix

for (const c of concepts) {
  const connected =
    isConnected(c, glossaryTitles) || hasIncoming.has(c.title.toLowerCase());
  if (!connected) {
    if (c.relatedTitles.length === 0) noLinks.push(c);
    else truelyIsolated.push(c);
  }
}

console.log(`Total concepts: ${concepts.length}`);
console.log(`Orphans with empty links (will re-fetch): ${noLinks.length}`);
console.log(`Orphans with links but no glossary overlap (cannot auto-fix): ${truelyIsolated.length}`);

if (truelyIsolated.length > 0) {
  console.log("\nConcepts that are truly isolated (no related concept in glossary):");
  for (const c of truelyIsolated) {
    console.log(`  - ${c.title} (${c.lang}) — ${c.relatedTitles.length} Wikipedia links, none in glossary`);
  }
}

if (noLinks.length === 0) {
  console.log("\nNothing to re-fetch.");
  process.exit(0);
}

if (dryRun) {
  console.log("\n--dry-run: no changes will be written.");
}

console.log("\nRe-fetching links…\n");

let fixed = 0;
let stillIsolated = 0;
let failed = 0;

for (let i = 0; i < noLinks.length; i++) {
  const c = noLinks[i];
  process.stdout.write(`[${i + 1}/${noLinks.length}] ${c.title} … `);

  try {
    const relatedTitles = await fetchRelatedTitles(c.lang, c.title);

    const nowConnected =
      relatedTitles.some((t) => glossaryTitles.has(t.toLowerCase())) ||
      hasIncoming.has(c.title.toLowerCase());

    const idx = store.concepts.findIndex((x) => x.id === c.id);
    if (idx >= 0) {
      store.concepts[idx] = { ...store.concepts[idx], relatedTitles };
      if (!dryRun) writeStore(store);
    }

    if (nowConnected) {
      fixed++;
      console.log(`fixed (${relatedTitles.length} links)`);
    } else {
      stillIsolated++;
      console.log(`still isolated (${relatedTitles.length} links, none in glossary)`);
    }
  } catch (err) {
    failed++;
    console.log(`failed — ${err.message}`);
  }

  await sleep(DELAY_MS);
}

console.log(`\nFixed: ${fixed}`);
console.log(`Still isolated after re-fetch: ${stillIsolated}`);
console.log(`Failed: ${failed}`);
if (dryRun) console.log("Dry run: no file written.");
