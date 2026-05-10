"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Search, Loader2, BookOpen, ChevronDown } from "lucide-react";
import type { Concept } from "@/lib/store";

const DEFAULT_PAGE_SIZE = 50;

export default function Home() {
  const router = useRouter();
  const [concepts, setConcepts] = useState<Concept[]>([]);
  const [allConcepts, setAllConcepts] = useState<Concept[]>([]);
  const [query, setQuery] = useState("");
  const [queryDraft, setQueryDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [initialized, setInitialized] = useState(false);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [displayCount, setDisplayCount] = useState(DEFAULT_PAGE_SIZE);

  // Fetch settings then concepts
  useEffect(() => {
    let mounted = true;
    (async () => {
      setLoading(true);
      try {
        const [settingsRes, conceptsRes] = await Promise.all([
          fetch("/api/admin/settings").then((r) => r.json()).catch(() => ({})),
          fetch("/api/concepts").then((r) => r.json()),
        ]);
        if (!mounted) return;
        const size = settingsRes?.homepagePageSize ?? DEFAULT_PAGE_SIZE;
        setPageSize(size);
        setDisplayCount(size);
        setAllConcepts(conceptsRes);
        setConcepts(conceptsRes);
      } finally {
        if (mounted) {
          setLoading(false);
          setInitialized(true);
        }
      }
    })();
    return () => { mounted = false; };
  }, []);

  // Debounce user input
  useEffect(() => {
    const t = setTimeout(() => setQuery(queryDraft), 300);
    return () => clearTimeout(t);
  }, [queryDraft]);

  // Build Fuse index once corpus is loaded
  const fuseRef = useRef<any | null>(null);
  const MAX_RESULTS = 200;

  useEffect(() => {
    if (!allConcepts || allConcepts.length === 0) { fuseRef.current = null; return; }
    let mounted = true;
    (async () => {
      try {
        if (typeof window === "undefined") { fuseRef.current = null; return; }
        const mod = await import("fuse.js");
        if (!mounted) return;
        const F = (mod && (mod as any).default) || mod;
        fuseRef.current = new (F as any)(allConcepts, {
          keys: ["title", "definition"],
          threshold: 0.45,
          ignoreLocation: true,
          includeScore: true,
        });
      } catch { fuseRef.current = null; }
    })();
    return () => { mounted = false; };
  }, [allConcepts]);

  // Filter client-side from cached allConcepts
  useEffect(() => {
    if (!query.trim()) {
      setConcepts(allConcepts);
      setLoading(false);
      return;
    }

    if (query.length < 2) {
      const lower = query.toLowerCase();
      const filtered = allConcepts.filter((c) => c.title.toLowerCase().includes(lower));
      setConcepts(filtered.slice(0, MAX_RESULTS));
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      if (fuseRef.current) {
        const results = fuseRef.current.search(query, { limit: MAX_RESULTS });
        setConcepts((results as any[]).map((r: any) => r.item as Concept));
      } else {
        const lower = query.toLowerCase();
        setConcepts(
          allConcepts
            .filter((c) => c.title.toLowerCase().includes(lower) || c.definition.toLowerCase().includes(lower))
            .slice(0, MAX_RESULTS)
        );
      }
    } catch {
      const lower = query.toLowerCase();
      setConcepts(
        allConcepts
          .filter((c) => c.title.toLowerCase().includes(lower) || c.definition.toLowerCase().includes(lower))
          .slice(0, MAX_RESULTS)
      );
    } finally {
      setLoading(false);
    }
  }, [query, allConcepts]);

  // When query changes, reset displayCount
  useEffect(() => {
    if (!query.trim()) setDisplayCount(pageSize);
  }, [query, pageSize]);

  const isFiltering = query.trim().length > 0;
  const visibleConcepts = isFiltering ? concepts : concepts.slice(0, displayCount);
  const hasMore = !isFiltering && concepts.length > displayCount;

  return (
    <div className="space-y-8 animate-fade-in">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-zinc-400" />
        <input
          type="search"
          placeholder="Search concepts…"
          value={queryDraft}
          onChange={(e) => setQueryDraft(e.target.value)}
          className="w-full rounded-lg border border-zinc-200 bg-zinc-50 pl-9 pr-4 py-2.5 text-sm outline-none focus:border-zinc-400 focus:bg-white transition-colors placeholder:text-zinc-400"
        />
      </div>

      <div>
        {!initialized || loading ? (
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
                {visibleConcepts.map((concept) => (
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
                          <div className={(concept.thumbnail ? 'max-w-xxs' : 'max-w-xs') + `text-xs text-zinc-400 truncate`}>
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
            <div className="px-4 py-3 border-t border-zinc-100 flex items-center justify-between">
              <span className="text-xs text-zinc-400">
                {isFiltering
                  ? `${concepts.length} result${concepts.length !== 1 ? "s" : ""} for "${query}"`
                  : `${visibleConcepts.length} of ${concepts.length} concept${concepts.length !== 1 ? "s" : ""}`}
              </span>
              {hasMore && (
                <button
                  onClick={() => setDisplayCount((n) => n + pageSize)}
                  className="flex items-center gap-1 text-xs font-medium text-zinc-500 hover:text-zinc-900 transition-colors"
                >
                  <ChevronDown className="size-3.5" />
                  Load {Math.min(pageSize, concepts.length - displayCount)} more
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
