import fs from "fs";
import path from "path";

export type Settings = {
  inDegreeWeight: number;
  outDegreeWeight: number;
  randomRanking: boolean;
  homepagePageSize: number;
};

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

type Store = { concepts: Concept[]; settings?: Settings };

const DATA_PATH = path.join(process.cwd(), "data", "glossary.json");

const DEFAULT_SETTINGS: Settings = { randomRanking: false, inDegreeWeight: 0, outDegreeWeight: 0, homepagePageSize: 50 };

function read(): Store {
  try {
    const raw = fs.readFileSync(DATA_PATH, "utf-8");
    return JSON.parse(raw);
  } catch {
    return { concepts: [], settings: { ...DEFAULT_SETTINGS } };
  }
}

function write(store: Store): void {
  fs.writeFileSync(DATA_PATH, JSON.stringify(store, null, 2), "utf-8");
}

function shuffleConcepts(concepts: Concept[]): Concept[] {
  const shuffled = [...concepts];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

function smoothNormalize(value: number, max: number): number {
  if (value <= 0 || max <= 0) return 0;
  return Math.log1p(value) / Math.log1p(max);
}

function buildFrontierScores(
  concepts: Concept[],
  inDegreeWeight: number,
  outDegreeWeight: number
): Map<string, number> {
  const glossary = new Set(concepts.map((c) => c.title.toLowerCase()));

  const inDegree = new Map<string, number>();
  for (const c of concepts) {
    for (const t of c.relatedTitles) {
      const key = t.toLowerCase();
      if (glossary.has(key)) inDegree.set(key, (inDegree.get(key) ?? 0) + 1);
    }
  }

  // Find max degrees for proper normalization
  let maxInDegree = 0;
  let maxOutDegree = 0;
  for (const c of concepts) {
    const outDeg = c.relatedTitles.filter((t) => glossary.has(t.toLowerCase())).length;
    const inDeg = inDegree.get(c.title.toLowerCase()) ?? 0;
    maxInDegree = Math.max(maxInDegree, inDeg);
    maxOutDegree = Math.max(maxOutDegree, outDeg);
  }

  const scores = new Map<string, number>();
  for (const c of concepts) {
    const inDeg = inDegree.get(c.title.toLowerCase()) ?? 0;
    const outDeg = c.relatedTitles.filter((t) => glossary.has(t.toLowerCase())).length;

    // Pure degree-based score with smooth (log) curve
    let score = 0;

    // Apply inDegree weight: smooth normalized contribution in [0, 1]
    if (inDegreeWeight !== 0) {
      const inDegreeNorm = smoothNormalize(inDeg, maxInDegree);
      score += inDegreeWeight * inDegreeNorm;
    }

    // Apply outDegree weight: smooth normalized contribution in [0, 1]
    if (outDegreeWeight !== 0) {
      const outDegreeNorm = smoothNormalize(outDeg, maxOutDegree);
      score += outDegreeWeight * outDegreeNorm;
    }

    scores.set(c.id, score);
  }
  return scores;
}

export function getConcepts(): Concept[] {
  const store = read();
  const concepts = store.concepts;
  const settings: Settings = { ...DEFAULT_SETTINGS, ...(store.settings ?? {}) };
  if (settings.randomRanking) {
    return shuffleConcepts(concepts);
  }
  const scores = buildFrontierScores(
    concepts,
    settings.inDegreeWeight,
    settings.outDegreeWeight
  );
  return concepts.sort((a, b) => (scores.get(b.id) ?? 0) - (scores.get(a.id) ?? 0));
}

export function getSettings(): Settings {
  const store = read();
  return { ...DEFAULT_SETTINGS, ...(store.settings ?? {}) };
}

export function updateSettings(nextSettings: Partial<Settings>): Settings {
  const store = read();
  const current: Settings = { ...DEFAULT_SETTINGS, ...(store.settings ?? {}) };
  const updated: Settings = { ...current, ...nextSettings };
  store.settings = updated;
  write(store);
  return updated;
}

export function getConceptBySlug(slug: string): Concept | undefined {
  return read().concepts.find((c) => c.slug === slug);
}

export function getConceptById(id: string): Concept | undefined {
  return read().concepts.find((c) => c.id === id);
}

export function addConcept(concept: Concept): { concept: Concept; created: boolean } {
  const store = read();
  const existing = store.concepts.find((c) => c.url === concept.url);
  if (existing) return { concept: existing, created: false };
  store.concepts.push(concept);
  write(store);
  return { concept, created: true };
}

export function updateConcept(id: string, nextConcept: Concept): Concept | null {
  const store = read();
  const index = store.concepts.findIndex((c) => c.id === id);
  if (index < 0) return null;

  store.concepts[index] = nextConcept;
  write(store);
  return nextConcept;
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
