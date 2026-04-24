import fs from "fs";
import path from "path";

export type Concept = {
  id: string;
  title: string;
  slug: string;
  definition: string;
  url: string;
  thumbnail?: string;
  relatedTitles: string[];
  lang: string;
  createdAt: string;
};

type Store = { concepts: Concept[] };

const DATA_PATH = path.join(process.cwd(), "data", "glossary.json");

function read(): Store {
  try {
    const raw = fs.readFileSync(DATA_PATH, "utf-8");
    return JSON.parse(raw);
  } catch {
    return { concepts: [] };
  }
}

function write(store: Store): void {
  fs.writeFileSync(DATA_PATH, JSON.stringify(store, null, 2), "utf-8");
}

function buildFrontierScores(concepts: Concept[], exponent: number): Map<string, number> {
  const glossary = new Set(concepts.map((c) => c.title.toLowerCase()));

  const inDegree = new Map<string, number>();
  for (const c of concepts) {
    for (const t of c.relatedTitles) {
      const key = t.toLowerCase();
      if (glossary.has(key)) inDegree.set(key, (inDegree.get(key) ?? 0) + 1);
    }
  }

  const scores = new Map<string, number>();
  for (const c of concepts) {
    const total = c.relatedTitles.length;
    const outLinks = c.relatedTitles.filter((t) => !glossary.has(t.toLowerCase())).length;
    const deg = inDegree.get(c.title.toLowerCase()) ?? 0;
    const outRatio = total > 0 ? outLinks / total : 0;
    scores.set(c.id, outRatio * Math.log1p(deg) / Math.pow(deg + 1, exponent));
  }
  return scores;
}

export function getConcepts(exponent = 0.5): Concept[] {
  const concepts = read().concepts;
  const scores = buildFrontierScores(concepts, exponent);
  return concepts.sort((a, b) => (scores.get(b.id) ?? 0) - (scores.get(a.id) ?? 0));
}

export function getConceptBySlug(slug: string): Concept | undefined {
  return read().concepts.find((c) => c.slug === slug);
}

export function addConcept(concept: Concept): { concept: Concept; created: boolean } {
  const store = read();
  const existing = store.concepts.find((c) => c.url === concept.url);
  if (existing) return { concept: existing, created: false };
  store.concepts.push(concept);
  write(store);
  return { concept, created: true };
}

export function deleteConcept(id: string): boolean {
  const store = read();
  const before = store.concepts.length;
  store.concepts = store.concepts.filter((c) => c.id !== id);
  if (store.concepts.length !== before) {
    write(store);
    return true;
  }
  return false;
}
