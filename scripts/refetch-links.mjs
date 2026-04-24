import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const DATA_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../data/glossary.json"
);
const DELAY_MS = 200;
const MAX_RETRIES = 3;

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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchRelatedTitles(lang, title, attempt = 1) {
  const links = [];
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

    const res = await fetch(
      `https://${lang}.wikipedia.org/w/api.php?` + new URLSearchParams(params),
      { headers: { "User-Agent": "Blanket-Glossary/1.0" } }
    );

    if (res.status === 429 || res.status >= 500) {
      if (attempt <= MAX_RETRIES) {
        const wait = DELAY_MS * 5 * attempt;
        process.stdout.write(`[retry ${attempt}/${MAX_RETRIES} in ${wait}ms] `);
        await sleep(wait);
        return fetchRelatedTitles(lang, title, attempt + 1);
      }
      break;
    }
    if (!res.ok) break;

    const data = await res.json();
    const pages = Object.values(data.query?.pages || {});
    const batch = (pages[0]?.links ?? [])
      .map((l) => l.title)
      .filter(isConceptLink);
    links.push(...batch);
    plcontinue = data.continue?.plcontinue;

    if (plcontinue) await sleep(DELAY_MS);
  } while (plcontinue);

  return links;
}

const store = JSON.parse(fs.readFileSync(DATA_PATH, "utf-8"));
const concepts = store.concepts;

const toUpdate = concepts.filter((c) => c.relatedTitles.length === 0);
console.log(`Updating ${toUpdate.length}/${concepts.length} concept(s) with missing links…\n`);

for (const concept of toUpdate) {
  process.stdout.write(`  ${concept.title} … `);
  concept.relatedTitles = await fetchRelatedTitles(concept.lang, concept.title);
  console.log(`${concept.relatedTitles.length} links`);
  await sleep(DELAY_MS);
}

fs.writeFileSync(DATA_PATH, JSON.stringify(store, null, 2), "utf-8");
console.log("\nDone.");
