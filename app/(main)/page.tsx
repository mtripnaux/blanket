"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Search, Loader2, BookOpen, ChevronDown } from "lucide-react";

type SlimConcept = {
  id: string;
  slug: string;
  title: string;
  definition: string;
  thumbnail?: string;
  lang: string;
  linkCount: number;
};

const DEFAULT_PAGE_SIZE = 50;

export default function Home() {
  const router = useRouter();
  const [firstPage, setFirstPage] = useState<SlimConcept[]>([]);
  const [allConcepts, setAllConcepts] = useState<SlimConcept[]>([]);
  const [allLoaded, setAllLoaded] = useState(false);
  const [searchResults, setSearchResults] = useState<SlimConcept[] | null>(null);
  const [query, setQuery] = useState("");
  const [queryDraft, setQueryDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [initialized, setInitialized] = useState(false);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [displayCount, setDisplayCount] = useState(DEFAULT_PAGE_SIZE);

  // Phase 1: fetch settings + first page in parallel → fast first paint
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const [settingsRes, firstPage] = await Promise.all([
          fetch("/api/admin/settings").then((r) => r.json()).catch(() => ({})),
          fetch(`/api/concepts?slim=1&limit=${DEFAULT_PAGE_SIZE}`).then((r) => r.json()),
        ]);
        if (!mounted) return;
        const size = settingsRes?.homepagePageSize ?? DEFAULT_PAGE_SIZE;
        setPageSize(size);
        setDisplayCount(size);
        setFirstPage(firstPage);
      } finally {
        if (mounted) {
          setLoading(false);
          setInitialized(true);
        }
      }
    })();
    return () => { mounted = false; };
  }, []);

  // Phase 2: background-load all concepts for search (non-blocking)
  useEffect(() => {
    if (!initialized) return;
    let mounted = true;
    fetch("/api/concepts?slim=1")
      .then((r) => r.json())
      .then((all: SlimConcept[]) => {
        if (!mounted) return;
        setAllConcepts(all);
        setAllLoaded(true);
      })
      .catch(() => {});
    return () => { mounted = false; };
  }, [initialized]); // eslint-disable-line react-hooks/exhaustive-deps

  // Debounce user input
  useEffect(() => {
    const t = setTimeout(() => setQuery(queryDraft), 300);
    return () => clearTimeout(t);
  }, [queryDraft]);

  // Build Fuse index once all concepts are loaded
  const fuseRef = useRef<any | null>(null);
  const MAX_RESULTS = 200;

  useEffect(() => {
    if (!allLoaded || allConcepts.length === 0) { fuseRef.current = null; return; }
    let mounted = true;
    (async () => {
      try {
        if (typeof window === "undefined") { fuseRef.current = null; return; }
        const mod = await import("fuse.js");
        if (!mounted) return;
        const F = (mod && (mod as any).default) || mod;
        fuseRef.current = new (F as any)(allConcepts, {
          keys: [{ name: "title", weight: 2 }, "definition"],
          threshold: 0.45,
          ignoreLocation: true,
          includeScore: true,
        });
      } catch { fuseRef.current = null; }
    })();
    return () => { mounted = false; };
  }, [allLoaded, allConcepts]);

  // Search: server-side while background load pending, Fuse after
  useEffect(() => {
    if (!query.trim()) {
      setSearchResults(null);
      return;
    }

    if (!allLoaded) {
      fetch(`/api/concepts?slim=1&q=${encodeURIComponent(query)}`)
        .then((r) => r.json())
        .then(setSearchResults)
        .catch(() => {});
      return;
    }

    if (query.length < 2) {
      const lower = query.toLowerCase();
      setSearchResults(allConcepts.filter((c) => c.title.toLowerCase().includes(lower)).slice(0, MAX_RESULTS));
      return;
    }

    try {
      if (fuseRef.current) {
        const results = fuseRef.current.search(query, { limit: MAX_RESULTS });
        setSearchResults((results as any[]).map((r: any) => r.item as SlimConcept));
      } else {
        const lower = query.toLowerCase();
        setSearchResults(
          allConcepts
            .filter((c) => c.title.toLowerCase().includes(lower) || c.definition.toLowerCase().includes(lower))
            .slice(0, MAX_RESULTS)
        );
      }
    } catch {
      const lower = query.toLowerCase();
      setSearchResults(
        allConcepts
          .filter((c) => c.title.toLowerCase().includes(lower) || c.definition.toLowerCase().includes(lower))
          .slice(0, MAX_RESULTS)
      );
    }
  }, [query, allConcepts, allLoaded]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reset displayCount when clearing search
  useEffect(() => {
    if (!query.trim()) setDisplayCount(pageSize);
  }, [query, pageSize]);

  const isFiltering = query.trim().length > 0;
  // Only switch to allConcepts when the user has explicitly paginated beyond the first page
  // to avoid a re-render flash when the background load completes.
  const listSource = (allLoaded && displayCount > pageSize) ? allConcepts : firstPage;
  const visibleConcepts = isFiltering ? (searchResults ?? []) : listSource.slice(0, displayCount);
  const hasMore = !isFiltering && allLoaded && allConcepts.length > displayCount;

  return (
    <div className="space-y-8 animate-fade-in">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-zinc-400" />
        <input
          type="search"
          placeholder="Search concepts…"
          value={queryDraft}
          onChange={(e) => setQueryDraft(e.target.value)}
          className="w-full rounded-lg border border-zinc-200 bg-zinc-50 pl-9 pr-4 py-2.5 text-sm outline-none placeholder:text-zinc-400"
        />
      </div>

      <div>
        {!initialized || loading ? (
          <div className="flex items-center justify-center py-16 text-zinc-400">
            <Loader2 className="size-5 animate-spin" />
          </div>
        ) : visibleConcepts.length === 0 ? (
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
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="px-4 py-3 border-t border-zinc-100 flex items-center justify-between">
              <span className="text-xs text-zinc-400">
                {isFiltering
                  ? `${visibleConcepts.length} result${visibleConcepts.length !== 1 ? "s" : ""} for "${query}"`
                  : `${visibleConcepts.length} of ${allLoaded ? allConcepts.length : "…"} concept${allLoaded && allConcepts.length !== 1 ? "s" : ""}`}
              </span>
              {hasMore && (
                <button
                  onClick={() => setDisplayCount((n) => n + pageSize)}
                  className="flex items-center gap-1 text-xs font-medium text-zinc-500 hover:text-zinc-900 transition-colors"
                >
                  <ChevronDown className="size-3.5" />
                  Load {Math.min(pageSize, allConcepts.length - displayCount)} more
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
