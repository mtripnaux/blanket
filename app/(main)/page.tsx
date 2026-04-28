"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Search, Loader2, BookOpen } from "lucide-react";
import ConceptGraph from "@/components/ConceptGraph";
import type { Concept } from "@/lib/store";

export default function Home() {
  const router = useRouter();
  const [concepts, setConcepts] = useState<Concept[]>([]);
  const [allConcepts, setAllConcepts] = useState<Concept[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);

  const fetchConcepts = useCallback(async (q: string) => {
    setLoading(true);
    try {
      const [filtered, all] = await Promise.all([
        fetch(`/api/concepts?q=${encodeURIComponent(q)}`).then((r) => r.json()),
        q ? fetch("/api/concepts").then((r) => r.json()) : Promise.resolve(null),
      ]);
      setConcepts(filtered);
      const newAll = all ?? filtered;
      setAllConcepts((prev) => {
        if (prev.length === newAll.length && prev.every((c, i) => c.id === newAll[i]?.id)) return prev;
        return newAll;
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchConcepts(query);
  }, [query, fetchConcepts]);

  return (
    <div className="space-y-8 animate-fade-in">
      {/* <ConceptGraph concepts={allConcepts} /> */}

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-zinc-400" />
        <input
          type="search"
          placeholder="Search concepts…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-full rounded-lg border border-zinc-200 bg-zinc-50 pl-9 pr-4 py-2.5 text-sm outline-none focus:border-zinc-400 focus:bg-white transition-colors placeholder:text-zinc-400"
        />
      </div>

      <div>
        {loading ? (
          <div className="flex items-center justify-center py-16 text-zinc-400">
            <Loader2 className="size-5 animate-spin" />
          </div>
        ) : concepts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <BookOpen className="size-10 text-zinc-200 mb-4" />
            {query ? (
              <p className="text-sm text-zinc-400">
                No concepts found for{" "}
                <span className="font-medium text-zinc-600">"{query}"</span>
              </p>
            ) : (
              <>
                <p className="text-sm font-medium text-zinc-500 mb-1">Your glossary is empty</p>
                <p className="text-xs text-zinc-400">
                  Head to <Link href="/admin" className="underline hover:text-zinc-700 transition-colors">admin</Link> to add concepts
                </p>
              </>
            )}
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-zinc-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-100">
                  <th className="text-left px-4 py-3 text-xs font-medium text-zinc-400 uppercase tracking-wide">
                    Concept
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-zinc-400 uppercase tracking-wide w-14">
                    Lang
                  </th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-zinc-400 uppercase tracking-wide w-16">
                    Links
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {concepts.map((concept) => (
                  <tr
                    key={concept.id}
                    onClick={() => router.push(`/concept/${concept.slug}`)}
                    className="group hover:bg-zinc-50 transition-colors cursor-pointer"
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        {concept.thumbnail && (
                          <img
                            src={concept.thumbnail}
                            alt=""
                            className="size-8 rounded object-cover shrink-0 opacity-80 border border-zinc-100"
                          />
                        )}
                        <div className="min-w-0">
                          <div className="font-medium text-zinc-900 truncate">{concept.title}</div>
                          <div className="text-xs text-zinc-400 truncate max-w-xs">
                            {concept.definition.slice(0, 90)}{concept.definition.length > 90 ? "…" : ""}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-md bg-zinc-100 text-zinc-500 uppercase tracking-wide">
                        {concept.lang}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs tabular-nums text-zinc-400 text-right">
                      {concept.relatedTitles.length}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="px-4 py-3 border-t border-zinc-100 text-xs text-zinc-400">
              {concepts.length} concept{concepts.length > 1 ? "s" : ""}
              {query ? ` for "${query}"` : ""}
            </div>
          </div>
        )}
      </div>

    </div>
  );
}
