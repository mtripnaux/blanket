import { NextResponse } from "next/server";
import { getConcepts, getSettings } from "@/lib/store";

export async function GET() {
  const concepts = getConcepts();
  const settings = getSettings();
  
  // Manually rebuild scores with debug info
  const glossary = new Set(concepts.map((c) => c.title.toLowerCase()));

  const inDegree = new Map<string, number>();
  for (const c of concepts) {
    for (const t of c.relatedTitles) {
      const key = t.toLowerCase();
      if (glossary.has(key)) inDegree.set(key, (inDegree.get(key) ?? 0) + 1);
    }
  }

  // Find max degrees for normalization
  let maxInDegree = 0;
  let maxOutDegree = 0;
  for (const c of concepts) {
    const outDeg = c.relatedTitles.filter((t) => glossary.has(t.toLowerCase())).length;
    const inDeg = inDegree.get(c.title.toLowerCase()) ?? 0;
    maxInDegree = Math.max(maxInDegree, inDeg);
    maxOutDegree = Math.max(maxOutDegree, outDeg);
  }

  const smoothNormalize = (value: number, max: number): number => {
    if (value <= 0 || max <= 0) return 0;
    return Math.log1p(value) / Math.log1p(max);
  };

  const debugScores = concepts.map((c) => {
    const total = c.relatedTitles.length;
    const outLinks = c.relatedTitles.filter((t) => !glossary.has(t.toLowerCase())).length;
    const inDeg = inDegree.get(c.title.toLowerCase()) ?? 0;
    const outDeg = c.relatedTitles.filter((t) => glossary.has(t.toLowerCase())).length;
    const inDegreeNorm = smoothNormalize(inDeg, maxInDegree);
    const outDegreeNorm = smoothNormalize(outDeg, maxOutDegree);

    let score = 0;
    const baseScore = score;

    if (settings.inDegreeWeight !== 0) {
      score += settings.inDegreeWeight * inDegreeNorm;
    }

    if (settings.outDegreeWeight !== 0) {
      score += settings.outDegreeWeight * outDegreeNorm;
    }

    return {
      title: c.title,
      inDeg,
      outDeg,
      total,
      outLinks,
      inDegreeNorm: inDegreeNorm.toFixed(3),
      outDegreeNorm: outDegreeNorm.toFixed(3),
      baseScore: baseScore.toFixed(3),
      inDegreeBonus: settings.inDegreeWeight !== 0 ? (settings.inDegreeWeight * inDegreeNorm).toFixed(3) : "0",
      outDegreeBonus: settings.outDegreeWeight !== 0 ? (settings.outDegreeWeight * outDegreeNorm).toFixed(3) : "0",
      finalScore: score.toFixed(3),
    };
  }).sort((a, b) => parseFloat(b.finalScore) - parseFloat(a.finalScore));

  return NextResponse.json({
    settings,
    maxInDegree,
    maxOutDegree,
    topConcepts: debugScores.slice(0, 10),
  });
}
