"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Search, Plus, ArrowRight, Loader2, BookOpen } from "lucide-react";
import ConceptGraph from "@/components/ConceptGraph";
import { cn } from "@/lib/utils";
import type { Concept } from "@/lib/store";

type Suggestion = { title: string; lang: string; count: number };

function computeSuggestions(concepts: Concept[]): Suggestion[] {
  const existing = new Set(concepts.map((c) => c.title.toLowerCase()));
  const counts = new Map<string, Suggestion>();

  for (const concept of concepts) {
    for (const title of concept.relatedTitles) {
      if (existing.has(title.toLowerCase())) continue;
      const key = `${concept.lang}::${title.toLowerCase()}`;
      const entry = counts.get(key);
      if (entry) {
        entry.count++;
      } else {
        counts.set(key, { title, lang: concept.lang, count: 1 });
      }
    }
  }

  const all = Array.from(counts.values());
  for (let i = all.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [all[i], all[j]] = [all[j], all[i]];
  }
  return all.sort((a, b) => b.count - a.count).slice(0, 10);
}

export default function Home() {
  const searchParams = useSearchParams();
  const exponent = Math.max(0.1, Math.min(1.0, parseFloat(searchParams.get("exponent") ?? "0.5")));

  const [concepts, setConcepts] = useState<Concept[]>([]);
  const [allConcepts, setAllConcepts] = useState<Concept[]>([]);
  const [query, setQuery] = useState("");
  const [url, setUrl] = useState("");
  const [adding, setAdding] = useState(false);
  const [importingSlug, setImportingSlug] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);

  const suggestions = computeSuggestions(allConcepts);

  const fetchConcepts = useCallback(async (q: string) => {
    setLoading(true);
    try {
      const exp = `&exponent=${exponent}`;
      const [filtered, all] = await Promise.all([
        fetch(`/api/concepts?q=${encodeURIComponent(q)}${exp}`).then((r) => r.json()),
        q ? fetch(`/api/concepts?${exp}`).then((r) => r.json()) : Promise.resolve(null),
      ]);
      setConcepts(filtered);
      setAllConcepts((prev) => {
        const newAll = all ?? filtered;
        if (prev.length === newAll.length && prev.every((c: Concept, i: number) => c.id === newAll[i]?.id)) return prev;
        return newAll;
      });
    } finally {
      setLoading(false);
    }
  }, [exponent]);

  useEffect(() => {
    fetchConcepts(query);
  }, [query, fetchConcepts]);

  useEffect(() => {
    if (showForm) inputRef.current?.focus();
  }, [showForm]);

  async function importUrl(wikiUrl: string): Promise<boolean> {
    setError("");
    try {
      const res = await fetch("/api/concepts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: wikiUrl }),
      });
      const data = await res.json();
      if (res.status === 409) {
        setError("Already in your glossary");
        return false;
      }
      if (!res.ok) {
        setError(data.error || "Unknown error");
        return false;
      }
      await fetchConcepts(query);
      return true;
    } catch {
      setError("Could not reach the server");
      return false;
    }
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim()) return;
    setAdding(true);
    const ok = await importUrl(url);
    if (ok) {
      setUrl("");
      setShowForm(false);
    }
    setAdding(false);
  }

  async function handleSuggestion(s: Suggestion) {
    const wikiUrl = `https://${s.lang}.wikipedia.org/wiki/${encodeURIComponent(s.title.replace(/ /g, "_"))}`;
    const key = `${s.lang}::${s.title}`;
    setImportingSlug(key);
    await importUrl(wikiUrl);
    setImportingSlug(null);
  }

  return (
    <div className="space-y-8 animate-fade-in">
      {/* Graph */}
      <ConceptGraph concepts={allConcepts} />

      {/* Search + Add bar */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-zinc-400" />
          <input
            type="search"
            placeholder="Search concepts…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full rounded-lg border border-zinc-200 bg-zinc-50 pl-9 pr-4 py-2.5 text-sm outline-none focus:border-zinc-400 focus:bg-white transition-colors placeholder:text-zinc-400"
          />
        </div>
        <button
          onClick={() => { setShowForm((v) => !v); setError(""); }}
          className={cn(
            "flex items-center gap-1.5 rounded-lg px-3.5 py-2.5 text-sm font-medium transition-colors",
            showForm
              ? "bg-zinc-900 text-white"
              : "bg-zinc-900 text-white hover:bg-zinc-700"
          )}
        >
          <Plus className="size-4" />
          Add
        </button>
      </div>

      {/* Add form */}
      {showForm && (
        <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4 space-y-4 animate-fade-in">
          <div className="space-y-2">
            <label className="block text-xs font-medium text-zinc-500 uppercase tracking-wide">
              Wikipedia link
            </label>
            <form onSubmit={handleAdd} className="flex gap-2">
              <input
                ref={inputRef}
                type="url"
                placeholder="https://en.wikipedia.org/wiki/Photosynthesis"
                value={url}
                onChange={(e) => { setUrl(e.target.value); setError(""); }}
                className="flex-1 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-400 transition-colors placeholder:text-zinc-400"
              />
              <button
                type="submit"
                disabled={adding || !url.trim()}
                className="flex items-center gap-1.5 rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {adding ? <Loader2 className="size-4 animate-spin" /> : <ArrowRight className="size-4" />}
                {adding ? "Loading…" : "Import"}
              </button>
            </form>
            {error && <p className="text-xs text-red-500">{error}</p>}
          </div>

          {suggestions.length > 0 && (
            <div className="space-y-2 pt-1">
              <span className="text-xs font-medium text-zinc-400 uppercase tracking-wide">
                Blanket Frontier
              </span>
              <div className="flex flex-wrap gap-1.5">
                {suggestions.map((s) => {
                  const key = `${s.lang}::${s.title}`;
                  const isImporting = importingSlug === key;
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => handleSuggestion(s)}
                      disabled={importingSlug !== null}
                      className={cn(
                        "flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-all disabled:opacity-50",
                        isImporting
                          ? "border-zinc-400 bg-zinc-900 text-white"
                          : "border-zinc-200 bg-white text-zinc-600 hover:border-zinc-400 hover:text-zinc-900"
                      )}
                    >
                      {isImporting && <Loader2 className="size-3 animate-spin" />}
                      {s.title}
                      {s.count > 1 && (
                        <span className="ml-0.5 text-[10px] text-zinc-400">{s.count}</span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Concepts list */}
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
                <p className="text-xs text-zinc-400">Add a concept by pasting a Wikipedia link</p>
              </>
            )}
          </div>
        ) : (
          <ul className="divide-y divide-zinc-100">
            {concepts.map((concept) => (
              <li key={concept.id} className="group relative">
                <Link
                  href={`/concept/${concept.slug}`}
                  className="flex items-start justify-between gap-4 py-4 px-1 hover:px-3 rounded-lg transition-all hover:bg-zinc-50"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-medium text-zinc-900 text-sm">{concept.title}</span>
                      <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-md bg-zinc-100 text-zinc-500 uppercase tracking-wide">
                        {concept.lang}
                      </span>
                    </div>
                    <p className="text-xs text-zinc-500 line-clamp-2 leading-relaxed">
                      {concept.definition}
                    </p>
                  </div>
                  <ArrowRight className="size-4 text-zinc-300 group-hover:text-zinc-500 shrink-0 mt-0.5 transition-colors" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      {!loading && concepts.length > 0 && (
        <p className="text-xs text-zinc-400 text-center">
          {concepts.length} concept{concepts.length !== 1 ? "s" : ""}
          {query ? ` for "${query}"` : ""}
        </p>
      )}
    </div>
  );
}
