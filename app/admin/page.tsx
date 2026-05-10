"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Plus, Trash2, Loader2, ArrowRight, BookOpen, LogOut,
  Search, X, Check, Upload, Globe, BarChart3, Lock,
  ArrowUpDown, Hash, Network, RotateCw, Settings,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { Concept } from "@/lib/store";
import ConceptGraphExplorer from "@/components/ConceptGraphExplorer";

type Section = "overview" | "add" | "manage" | "graph" | "settings";
type Suggestion = { title: string; lang: string; count: number };
type SortOrder = "connections" | "alpha";
type ManageSort = "date-desc" | "date-asc" | "title" | "lang" | "links-desc" | "links-asc";
type BulkResult = {
  url: string;
  status: "success" | "error" | "duplicate" | "pending";
  message?: string;
  title?: string;
};

const ADMIN_SECTIONS: Section[] = ["overview", "add", "manage", "graph", "settings"];

function getSectionFromPathname(pathname: string): Section {
  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] !== "admin") return "add";
  const section = parts[1];
  if (section && ADMIN_SECTIONS.includes(section as Section)) return section as Section;
  return "add";
}

function computeSuggestions(
  concepts: Concept[],
  langFilter: string,
  minCount: number
): Suggestion[] {
  const existing = new Set(concepts.map((c) => c.title.toLowerCase()));
  const counts = new Map<string, Suggestion>();

  for (const concept of concepts) {
    for (const title of concept.relatedTitles) {
      if (existing.has(title.toLowerCase())) continue;
      if (langFilter !== "all" && concept.lang !== langFilter) continue;
      const key = `${concept.lang}::${title.toLowerCase()}`;
      const entry = counts.get(key);
      if (entry) {
        entry.count++;
      } else {
        counts.set(key, { title, lang: concept.lang, count: 1 });
      }
    }
  }

  return Array.from(counts.values()).filter((s) => s.count >= minCount);
}

function computeGraphStats(concepts: Concept[]) {
  const N = concepts.length;
  if (N < 2) return null;

  const titleIdx = new Map<string, number>();
  concepts.forEach((c, i) => titleIdx.set(c.title.toLowerCase(), i));

  // Build undirected edge set + directed counts for reciprocity
  const edgeSet = new Set<string>();
  const directedSet = new Set<string>();
  const degree = new Int32Array(N);
  const inDeg  = new Int32Array(N);
  const outDeg = new Int32Array(N);

  concepts.forEach((c, i) => {
    for (const t of c.relatedTitles) {
      const j = titleIdx.get(t.toLowerCase());
      if (j === undefined || j === i) continue;
      directedSet.add(`${i}→${j}`);
      outDeg[i]++;
      inDeg[j]++;
      const key = `${Math.min(i, j)}-${Math.max(i, j)}`;
      if (!edgeSet.has(key)) {
        edgeSet.add(key);
        degree[i]++;
        degree[j]++;
      }
    }
  });

  const E = edgeSet.size;
  const degArr = Array.from(degree);
  const avgDegree = (2 * E) / N;
  const density   = (2 * E) / (N * (N - 1));

  // Max degree & hub
  let maxDeg = 0, maxIdx = 0;
  for (let i = 0; i < N; i++) if (degree[i] > maxDeg) { maxDeg = degree[i]; maxIdx = i; }

  // Isolated nodes
  const isolated = degArr.filter(d => d === 0).length;

  // Reciprocity (fraction of directed edges that are mutual)
  let mutual = 0;
  for (const e of directedSet) {
    const [a, b] = e.split("→");
    if (directedSet.has(`${b}→${a}`)) mutual++;
  }
  const reciprocity = directedSet.size > 0 ? mutual / directedSet.size : 0;

  // Gini coefficient of degree distribution
  const sorted = [...degArr].sort((a, b) => a - b);
  const totalDeg = sorted.reduce((s, d) => s + d, 0);
  let giniNum = 0;
  for (let i = 0; i < N; i++) giniNum += (2 * (i + 1) - N - 1) * sorted[i];
  const gini = totalDeg > 0 ? giniNum / (N * totalDeg) : 0;

  // Shannon entropy of degree distribution
  const degCount = new Map<number, number>();
  for (const d of degArr) degCount.set(d, (degCount.get(d) ?? 0) + 1);
  let entropy = 0;
  for (const cnt of degCount.values()) {
    const p = cnt / N;
    entropy -= p * Math.log2(p);
  }
  const maxEntropy = Math.log2(N);

  // Connected components (BFS)
  const adj: number[][] = Array.from({ length: N }, () => []);
  for (const key of edgeSet) {
    const dash = key.indexOf("-");
    const a = +key.slice(0, dash), b = +key.slice(dash + 1);
    adj[a].push(b); adj[b].push(a);
  }
  const visited = new Uint8Array(N);
  let components = 0;
  const compSizes: number[] = [];
  for (let s = 0; s < N; s++) {
    if (visited[s]) continue;
    components++;
    const q = [s]; visited[s] = 1; let size = 0, head = 0;
    while (head < q.length) {
      const n = q[head++]; size++;
      for (const nb of adj[n]) if (!visited[nb]) { visited[nb] = 1; q.push(nb); }
    }
    compSizes.push(size);
  }
  const largestComponent = Math.max(...compSizes);

  // Average local clustering coefficient
  let ccSum = 0, ccCount = 0;
  for (let i = 0; i < N; i++) {
    const d = adj[i].length;
    if (d < 2) continue;
    const nbSet = new Set(adj[i]);
    let links = 0;
    for (const u of adj[i]) for (const v of adj[u]) if (nbSet.has(v)) links++;
    ccSum += links / (d * (d - 1));
    ccCount++;
  }
  const clustering = ccCount > 0 ? ccSum / ccCount : 0;

  // Degree histogram (log-binned for power-law inspection)
  const bins = 8;
  const hist = new Array(bins).fill(0);
  const maxD = maxDeg || 1;
  for (const d of degArr) {
    if (d === 0) continue;
    const bin = Math.min(bins - 1, Math.floor((d / maxD) * bins));
    hist[bin]++;
  }

  return {
    N, E, avgDegree, density, maxDeg, maxHub: concepts[maxIdx].title,
    isolated, reciprocity, gini, entropy, maxEntropy,
    components, largestComponent, clustering, hist, maxD,
  };
}

export default function AdminPage() {
  const pathname = usePathname();
  const [mounted, setMounted] = useState(false);
  const [auth, setAuth] = useState(false);
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [section, setSection] = useState<Section>("add");
  const [concepts, setConcepts] = useState<Concept[]>([]);
  const [loading, setLoading] = useState(false);

  // Add form
  const [importUrls, setImportUrls] = useState("");
  const [adding, setAdding] = useState(false);
  const [frontierLimit, setFrontierLimit] = useState(20);
  const [langFilter, setLangFilter] = useState("all");
  const [minCount, setMinCount] = useState(1);
  const [sortOrder, setSortOrder] = useState<SortOrder>("connections");

  // Import results
  const [bulkResults, setBulkResults] = useState<BulkResult[]>([]);

  // Manage
  const [manageSearch, setManageSearch] = useState("");
  const [manageSort, setManageSort] = useState<ManageSort>("date-desc");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [refreshingId, setRefreshingId] = useState<string | null>(null);

  // Settings
  const [inDegreeWeight, setInDegreeWeight] = useState(0);
  const [randomRanking, setRandomRanking] = useState(false);
  const [outDegreeWeight, setOutDegreeWeight] = useState(0);
  const [homepagePageSize, setHomepagePageSize] = useState(50);
  const [graphMaxNodes, setGraphMaxNodes] = useState<number | null>(1000);
  const [randomRankingDraft, setRandomRankingDraft] = useState(false);
  const [inDegreeWeightDraft, setInDegreeWeightDraft] = useState("0");
  const [outDegreeWeightDraft, setOutDegreeWeightDraft] = useState("0");
  const [homepagePageSizeDraft, setHomepagePageSizeDraft] = useState("50");
  const [graphMaxNodesDraft, setGraphMaxNodesDraft] = useState<number | null>(1000);
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsError, setSettingsError] = useState("");
  const [settingsSuccess, setSettingsSuccess] = useState("");

  useEffect(() => {
    setMounted(true);
    const stored = sessionStorage.getItem("blanket_admin_auth");
    if (stored === "1") setAuth(true);
  }, []);

  useEffect(() => {
    const nextSection = getSectionFromPathname(pathname);
    setSection((prev) => (prev === nextSection ? prev : nextSection));
  }, [pathname]);

  const fetchConcepts = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/concepts");
      const data = await res.json();
      setConcepts(Array.isArray(data) ? data : []);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchSettings = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/settings");
      const data = await res.json();
      setRandomRanking(Boolean(data.randomRanking ?? false));
      setRandomRankingDraft(Boolean(data.randomRanking ?? false));
      setInDegreeWeight(data.inDegreeWeight ?? 0);
      setInDegreeWeightDraft((data.inDegreeWeight ?? 0).toString());
      setOutDegreeWeight(data.outDegreeWeight ?? 0);
      setOutDegreeWeightDraft((data.outDegreeWeight ?? 0).toString());
      setHomepagePageSize(data.homepagePageSize ?? 50);
      setHomepagePageSizeDraft((data.homepagePageSize ?? 50).toString());
      const gmn = "graphMaxNodes" in data ? data.graphMaxNodes : 1000;
      setGraphMaxNodes(gmn);
      setGraphMaxNodesDraft(gmn);
    } catch {
      // Use defaults
    }
  }, []);

  useEffect(() => {
    if (auth) fetchConcepts();
  }, [auth, fetchConcepts]);

  useEffect(() => {
    if (auth) fetchSettings();
  }, [auth, fetchSettings]);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setAuthLoading(true);
    setAuthError("");
    try {
      const res = await fetch("/api/admin/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        sessionStorage.setItem("blanket_admin_auth", "1");
        setAuth(true);
      } else {
        setAuthError("Invalid password");
        setPassword("");
      }
    } catch {
      setAuthError("Cannot reach the server");
    } finally {
      setAuthLoading(false);
    }
  }

  function handleLogout() {
    sessionStorage.removeItem("blanket_admin_auth");
    setAuth(false);
    setPassword("");
  }

  async function importUrl(wikiUrl: string): Promise<{ ok: boolean; error?: string; title?: string }> {
    try {
      const res = await fetch("/api/concepts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: wikiUrl }),
      });
      const data = await res.json();
      if (res.status === 409) return { ok: false, error: "Already in glossary" };
      if (!res.ok) return { ok: false, error: data.error || "Unknown error" };
      setConcepts((prev) => [...prev, data]);
      return { ok: true, title: data.title };
    } catch {
      return { ok: false, error: "Could not reach the server" };
    }
  }

  async function handleImport(e: React.FormEvent) {
    e.preventDefault();
    const lines = importUrls.split("\n").map((l) => l.trim()).filter(Boolean);
    if (!lines.length) return;

    setAdding(true);

    const finalStatuses: BulkResult[] = lines.map((u) => ({ url: u, status: "pending" }));
    setBulkResults(finalStatuses);

    for (let i = 0; i < lines.length; i++) {
      const wikiUrl = lines[i];
      const result = await importUrl(wikiUrl);
      const status = result.ok ? "success" : result.error === "Already in glossary" ? "duplicate" : "error";
      finalStatuses[i] = { url: wikiUrl, status, message: result.error, title: result.title };
      setBulkResults([...finalStatuses]);
    }

    // Keep only failed URLs in the textarea so the user can retry them
    const failedUrls = lines.filter((_, i) => finalStatuses[i]?.status === "error");
    setImportUrls(failedUrls.join("\n"));
    setAdding(false);
  }

  function handleSuggestion(s: Suggestion) {
    const wikiUrl = `https://${s.lang}.wikipedia.org/wiki/${encodeURIComponent(s.title.replace(/ /g, "_"))}`;
    setImportUrls((prev) => (prev.trim() ? prev.trimEnd() + "\n" + wikiUrl : wikiUrl));
  }

  async function handleDelete(id: string) {
    setDeletingId(id);
    try {
      const res = await fetch(`/api/concepts/${id}`, { method: "DELETE" });
      if (res.ok) setConcepts((prev) => prev.filter((c) => c.id !== id));
    } finally {
      setDeletingId(null);
    }
  }

  async function handleRefresh(id: string, title: string) {
    setRefreshingId(id);
    try {
      const res = await fetch(`/api/concepts/${id}`, { method: "PATCH" });
      const data = await res.json();
      if (!res.ok) {
        window.alert(data.error || `Could not refresh ${title}`);
        return;
      }
      setConcepts((prev) => prev.map((c) => c.id === id ? data : c));
    } finally {
      setRefreshingId(null);
    }
  }

  async function handleSaveSettings(e: React.FormEvent) {
    e.preventDefault();
    setSavingSettings(true);
    setSettingsError("");
    setSettingsSuccess("");
    try {
      const finalInDegree = parseFloat(inDegreeWeightDraft) || 0;
      const finalOutDegree = parseFloat(outDegreeWeightDraft) || 0;
      const finalPageSize = Math.max(1, parseInt(homepagePageSizeDraft, 10) || 50);
      const finalGraphMaxNodes = graphMaxNodesDraft === null ? null : Math.max(1, graphMaxNodesDraft);

      const res = await fetch("/api/admin/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ randomRanking: randomRankingDraft, inDegreeWeight: finalInDegree, outDegreeWeight: finalOutDegree, homepagePageSize: finalPageSize, graphMaxNodes: finalGraphMaxNodes }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSettingsError(data.error || "Error saving settings");
        return;
      }
      setRandomRanking(Boolean(data.randomRanking));
      setRandomRankingDraft(Boolean(data.randomRanking));
      setInDegreeWeight(data.inDegreeWeight);
      setInDegreeWeightDraft(data.inDegreeWeight.toString());
      setOutDegreeWeight(data.outDegreeWeight);
      setOutDegreeWeightDraft(data.outDegreeWeight.toString());
      setHomepagePageSize(data.homepagePageSize ?? 50);
      setHomepagePageSizeDraft((data.homepagePageSize ?? 50).toString());
      const gmn = "graphMaxNodes" in data ? data.graphMaxNodes : 1000;
      setGraphMaxNodes(gmn);
      setGraphMaxNodesDraft(gmn);
      setSettingsSuccess("Settings saved");
      setTimeout(() => setSettingsSuccess(""), 3000);
    } catch {
      setSettingsError("Could not save settings");
    } finally {
      setSavingSettings(false);
    }
  }

  // Derived state
  const langs = Array.from(new Set(concepts.map((c) => c.lang))).sort();
  const rawSuggestions = computeSuggestions(concepts, langFilter, minCount);
  const sortedSuggestions = [...rawSuggestions].sort((a, b) =>
    sortOrder === "connections" ? b.count - a.count : a.title.localeCompare(b.title)
  );
  const visibleSuggestions = sortedSuggestions.slice(0, frontierLimit);

  const filteredConcepts = concepts
    .filter(
      (c) =>
        !manageSearch ||
        c.title.toLowerCase().includes(manageSearch.toLowerCase()) ||
        c.definition.toLowerCase().includes(manageSearch.toLowerCase())
    )
    .sort((a, b) => {
      if (manageSort === "date-desc") return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      if (manageSort === "date-asc") return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      if (manageSort === "title") return a.title.localeCompare(b.title);
      if (manageSort === "lang") return a.lang.localeCompare(b.lang);
      if (manageSort === "links-desc") return b.relatedTitles.length - a.relatedTitles.length;
      if (manageSort === "links-asc") return a.relatedTitles.length - b.relatedTitles.length;
      return 0;
    });

  const langStats = concepts.reduce((acc, c) => {
    acc[c.lang] = (acc[c.lang] ?? 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const mostConnected = [...concepts]
    .sort((a, b) => b.relatedTitles.length - a.relatedTitles.length)
    .slice(0, 5);

  const graphStats = useMemo(() => computeGraphStats(concepts), [concepts]);

  if (!mounted) return null;

  // ─── Password gate ──────────────────────────────────────────────────────────
  if (!auth) {
    return (
      <div className="min-h-screen bg-zinc-50 flex items-center justify-center p-4">
        <div className="w-full max-w-sm">
          <div className="mb-8 text-center">
            <div className="inline-flex items-center gap-2 mb-2">
              <span className="text-xl font-semibold tracking-tight">blanket</span>
              <span className="text-sm font-medium text-zinc-500">admin</span>
            </div>
            <p className="text-xs text-zinc-400">Enter your password to continue</p>
          </div>
          <form
            onSubmit={handleLogin}
            className="bg-white rounded-xl border border-zinc-200 p-6 space-y-4 shadow-sm"
          >
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-zinc-500 uppercase tracking-wide">
                Password
              </label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-zinc-400" />
                <input
                  type="password"
                  autoFocus
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); setAuthError(""); }}
                  placeholder="••••••••"
                  className="w-full rounded-lg border border-zinc-200 bg-zinc-50 pl-9 pr-4 py-2.5 text-sm outline-none focus:border-zinc-400 focus:bg-white transition-colors"
                />
              </div>
              {authError && <p className="text-xs text-red-500">{authError}</p>}
            </div>
            <button
              type="submit"
              disabled={authLoading || !password}
              className="w-full flex items-center justify-center gap-2 rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 transition-colors"
            >
              {authLoading ? <Loader2 className="size-4 animate-spin" /> : <ArrowRight className="size-4" />}
              {authLoading ? "Verifying…" : "Enter"}
            </button>
          </form>
          <p className="mt-5 text-center">
            <Link href="/" className="text-xs text-zinc-400 hover:text-zinc-600 transition-colors">
              ← Back to glossary
            </Link>
          </p>
        </div>
      </div>
    );
  }

  // ─── Admin shell ────────────────────────────────────────────────────────────
  const navItems: { id: Section; label: string; icon: React.ReactNode }[] = [
    { id: "overview", label: "Overview", icon: <BarChart3 className="size-4" /> },
    { id: "add", label: "Add concepts", icon: <Plus className="size-4" /> },
    { id: "manage", label: "Manage", icon: <BookOpen className="size-4" /> },
    { id: "graph", label: "Graph", icon: <Network className="size-4" /> },
    { id: "settings", label: "Settings", icon: <Settings className="size-4" /> },
  ];

  return (
    <div className="min-h-screen bg-zinc-50 flex flex-col">
      {/* Top bar */}
      <header className="bg-white border-b border-zinc-200 px-5 py-3 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <Link
            href="/"
            className="text-xl font-semibold tracking-tight text-zinc-900 hover:text-zinc-500 transition-colors"
          >
            blanket
          </Link>
          <span className="text-zinc-400 text-sm font-normal mt-0.5">admin</span>
        </div>
        <div className="flex items-center gap-4">
          {loading && <Loader2 className="size-3.5 text-zinc-400 animate-spin" />}
          <span className="text-xs text-zinc-400 tabular-nums">
            {concepts.length} concept{concepts.length !== 1 ? "s" : ""}
          </span>
          <button
            onClick={handleLogout}
            className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 transition-colors"
          >
            <LogOut className="size-3.5" />
            Logout
          </button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <nav className="w-48 bg-white border-r border-zinc-200 p-2.5 space-y-0.5 shrink-0">
          {navItems.map((item) => (
            <Link
              key={item.id}
              href={item.id === "add" ? "/admin" : `/admin/${item.id}`}
              className={cn(
                "w-full flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors text-left",
                section === item.id
                  ? "bg-zinc-900 text-white"
                  : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900"
              )}
            >
              {item.icon}
              {item.label}
            </Link>
          ))}
        </nav>

        {/* Content */}
        <main className="flex-1 overflow-y-auto p-6">

          {/* ── OVERVIEW ─────────────────────────────────────────────────── */}
          {section === "overview" && (
            <div className="max-w-2xl space-y-6 animate-fade-in">
              <div>
                <h2 className="text-base font-semibold text-zinc-900 mb-0.5">Overview</h2>
                <p className="text-sm text-zinc-400">Your glossary</p>
              </div>

              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: "Concepts", value: concepts.length },
                  { label: "Languages", value: langs.length },
                  { label: "Frontier", value: computeSuggestions(concepts, "all", 1).length },
                ].map(({ label, value }) => (
                  <div key={label} className="bg-white rounded-xl border border-zinc-200 p-4">
                    <p className="text-xs font-medium text-zinc-400 uppercase tracking-wide mb-2">
                      {label}
                    </p>
                    <p className="text-3xl font-semibold tabular-nums text-zinc-900">{value}</p>
                  </div>
                ))}
              </div>

              {graphStats && (
                <>
                  {/* Network topology */}
                  <div className="bg-white rounded-xl border border-zinc-200 p-5 space-y-4">
                    <h3 className="text-xs font-medium text-zinc-400 uppercase tracking-wide">Network topology</h3>
                    <div className="grid grid-cols-2 gap-x-8 gap-y-3">
                      {[
                        { label: "Edges", value: graphStats.E.toLocaleString() },
                        { label: "Avg degree", value: graphStats.avgDegree.toFixed(1) },
                        { label: "Density", value: `${(graphStats.density * 100).toFixed(3)}%` },
                        { label: "Max degree", value: `${graphStats.maxDeg} (${graphStats.maxHub})`, mono: false },
                        { label: "Isolated nodes", value: graphStats.isolated },
                        { label: "Reciprocity", value: `${(graphStats.reciprocity * 100).toFixed(1)}%` },
                        { label: "Components", value: graphStats.components },
                        { label: "Largest component", value: `${graphStats.largestComponent} nodes` },
                        { label: "Avg clustering", value: graphStats.clustering.toFixed(3) },
                        { label: "Gini coefficient", value: graphStats.gini.toFixed(3) },
                      ].map(({ label, value, mono = true }) => (
                        <div key={label} className="flex items-baseline justify-between gap-2 border-b border-zinc-50 pb-2">
                          <span className="text-xs text-zinc-400 shrink-0">{label}</span>
                          <span className={`text-xs font-medium text-zinc-800 text-right truncate ${mono ? "tabular-nums" : ""}`}>{value}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Degree distribution */}
                  <div className="bg-white rounded-xl border border-zinc-200 p-5 space-y-4">
                    <div className="flex items-center justify-between">
                      <h3 className="text-xs font-medium text-zinc-400 uppercase tracking-wide">Degree distribution</h3>
                      <span className="text-xs text-zinc-400">
                        entropy {graphStats.entropy.toFixed(2)} / {graphStats.maxEntropy.toFixed(2)} bits
                      </span>
                    </div>
                    <div className="flex items-end gap-1 h-16">
                      {graphStats.hist.map((count, i) => {
                        const pct = graphStats.hist.reduce((a, b) => Math.max(a, b), 0);
                        const low = Math.round((i / graphStats.hist.length) * graphStats.maxD);
                        const high = Math.round(((i + 1) / graphStats.hist.length) * graphStats.maxD);
                        return (
                          <div key={i} className="flex-1 flex flex-col items-center gap-1 group relative">
                            <div
                              className="w-full bg-zinc-200 group-hover:bg-zinc-400 rounded-sm transition-colors"
                              style={{ height: pct > 0 ? `${Math.max(4, (count / pct) * 56)}px` : "4px" }}
                            />
                            <div className="absolute bottom-full mb-1 hidden group-hover:block bg-zinc-900 text-white text-[10px] rounded px-1.5 py-0.5 whitespace-nowrap z-10">
                              deg {low}–{high}: {count}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    <div className="flex justify-between text-[10px] text-zinc-400">
                      <span>deg 0</span>
                      <span>deg {graphStats.maxD}</span>
                    </div>
                  </div>
                </>
              )}

              {Object.keys(langStats).length > 0 && (
                <div className="bg-white rounded-xl border border-zinc-200 p-5 space-y-4">
                  <h3 className="text-xs font-medium text-zinc-400 uppercase tracking-wide">
                    By language
                  </h3>
                  <div className="space-y-2.5">
                    {Object.entries(langStats)
                      .sort((a, b) => b[1] - a[1])
                      .map(([lang, count]) => (
                        <div key={lang} className="flex items-center gap-3">
                          <span className="text-xs font-medium text-zinc-500 uppercase w-7 shrink-0">
                            {lang}
                          </span>
                          <div className="flex-1 bg-zinc-100 rounded-full h-1.5">
                            <div
                              className="bg-zinc-900 h-1.5 rounded-full transition-all"
                              style={{ width: `${(count / concepts.length) * 100}%` }}
                            />
                          </div>
                          <span className="text-xs tabular-nums text-zinc-400 w-4 text-right">
                            {count}
                          </span>
                        </div>
                      ))}
                  </div>
                </div>
              )}

              {mostConnected.length > 0 && (
                <div className="bg-white rounded-xl border border-zinc-200 p-5 space-y-3">
                  <h3 className="text-xs font-medium text-zinc-400 uppercase tracking-wide">
                    Most connected
                  </h3>
                  <ul className="divide-y divide-zinc-100">
                    {mostConnected.map((c) => (
                      <li key={c.id} className="flex items-center justify-between py-2.5 first:pt-0 last:pb-0">
                        <Link
                          href={`/concept/${c.slug}`}
                          target="_blank"
                          className="text-sm font-medium text-zinc-900 hover:underline"
                        >
                          {c.title}
                        </Link>
                        <span className="text-xs tabular-nums text-zinc-400">
                          {c.relatedTitles.length} links
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* ── ADD ──────────────────────────────────────────────────────── */}
          {section === "add" && (
            <div className="max-w-2xl space-y-5 animate-fade-in">
              <div>
                <h2 className="text-base font-semibold text-zinc-900 mb-0.5">Learn new concepts</h2>
                <p className="text-sm text-zinc-400">Explore your knowledge frontier</p>
              </div>

              {/* Import from URL(s) */}
              <div className="bg-white rounded-xl border border-zinc-200 p-5 space-y-4">
                <h3 className="text-xs font-medium text-zinc-400 uppercase tracking-wide">
                  Import from Wikipedia URL(s)
                </h3>
                <form onSubmit={handleImport} className="space-y-2">
                  <textarea
                    value={importUrls}
                    onChange={(e) => setImportUrls(e.target.value)}
                    placeholder={
                      "https://en.wikipedia.org/wiki/Photosynthesis\nhttps://en.wikipedia.org/wiki/Entropy\nhttps://fr.wikipedia.org/wiki/Complexité"
                    }
                    rows={4}
                    disabled={adding}
                    className="w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2.5 text-sm outline-none focus:border-zinc-400 focus:bg-white transition-colors placeholder:text-zinc-400 font-mono resize-none leading-relaxed disabled:opacity-50 disabled:cursor-not-allowed"
                  />
                  <div className="flex items-center gap-3">
                    <button
                      type="submit"
                      disabled={adding || !importUrls.trim()}
                      className="flex items-center gap-1.5 rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 transition-colors"
                    >
                      {adding ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <Upload className="size-4" />
                      )}
                      {adding ? "Importing…" : "Import"}
                    </button>
                    {bulkResults.length > 0 && !adding && (
                      <button
                        type="button"
                        onClick={() => { setBulkResults([]); setImportUrls(""); }}
                        className="text-xs text-zinc-400 hover:text-zinc-700 transition-colors"
                      >
                        Clear
                      </button>
                    )}
                  </div>
                </form>
                {bulkResults.length > 0 && (
                  <ul className="space-y-1.5 border-t border-zinc-100 pt-4">
                    {bulkResults.map((r, i) => (
                      <li key={i} className="flex items-center gap-2 text-xs">
                        {r.status === "pending" && (
                          <Loader2 className="size-3.5 text-zinc-400 animate-spin shrink-0" />
                        )}
                        {r.status === "success" && (
                          <Check className="size-3.5 text-emerald-500 shrink-0" />
                        )}
                        {r.status === "duplicate" && (
                          <span className="text-amber-500 shrink-0 font-bold leading-none">≈</span>
                        )}
                        {r.status === "error" && (
                          <X className="size-3.5 text-red-500 shrink-0" />
                        )}
                        <span
                          className={cn(
                            "truncate",
                            r.status === "success" && "text-zinc-700",
                            r.status === "duplicate" && "text-amber-600",
                            r.status === "error" && "text-red-500",
                            r.status === "pending" && "text-zinc-400"
                          )}
                        >
                          {r.status === "success" ? (r.title ?? r.url) : r.url}
                        </span>
                        {r.message && r.status !== "success" && (
                          <span className="text-zinc-400 shrink-0">— {r.message}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* Frontier Explorer */}
              <div className="bg-white rounded-xl border border-zinc-200 p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-medium text-zinc-400 uppercase tracking-wide">
                    Frontier Explorer
                  </h3>
                  <span className="text-xs text-zinc-400 tabular-nums">
                    {rawSuggestions.length} suggestions
                  </span>
                </div>

                {/* Filter bar */}
                <div className="flex flex-wrap gap-2">
                  <div className="flex items-center gap-1.5 rounded-lg border border-zinc-200 px-2.5 py-1.5 text-xs bg-zinc-50">
                    <Globe className="size-3.5 text-zinc-400 shrink-0" />
                    <select
                      value={langFilter}
                      onChange={(e) => { setLangFilter(e.target.value); setFrontierLimit(20); }}
                      className="outline-none bg-transparent text-zinc-600 cursor-pointer"
                    >
                      <option value="all">All languages</option>
                      {langs.map((l) => (
                        <option key={l} value={l}>{l.toUpperCase()}</option>
                      ))}
                    </select>
                  </div>

                  <div className="flex items-center gap-1.5 rounded-lg border border-zinc-200 px-2.5 py-1.5 text-xs bg-zinc-50">
                    <Hash className="size-3.5 text-zinc-400 shrink-0" />
                    <select
                      value={minCount}
                      onChange={(e) => { setMinCount(Number(e.target.value)); setFrontierLimit(20); }}
                      className="outline-none bg-transparent text-zinc-600 cursor-pointer"
                    >
                      <option value={1}>Min 1 link</option>
                      <option value={2}>Min 2 links</option>
                      <option value={3}>Min 3 links</option>
                      <option value={5}>Min 5 links</option>
                      <option value={10}>Min 10 links</option>
                    </select>
                  </div>

                  <div className="flex items-center gap-1.5 rounded-lg border border-zinc-200 px-2.5 py-1.5 text-xs bg-zinc-50">
                    <ArrowUpDown className="size-3.5 text-zinc-400 shrink-0" />
                    <select
                      value={sortOrder}
                      onChange={(e) => setSortOrder(e.target.value as SortOrder)}
                      className="outline-none bg-transparent text-zinc-600 cursor-pointer"
                    >
                      <option value="connections">By connections</option>
                      <option value="alpha">Alphabetical</option>
                    </select>
                  </div>
                </div>

                {/* Chips */}
                {visibleSuggestions.length === 0 ? (
                  <p className="text-sm text-zinc-400 py-6 text-center">
                    No suggestions with current filters
                  </p>
                ) : (
                  <div className="space-y-3">
                    <div className="flex flex-wrap gap-1.5">
                      {visibleSuggestions.map((s) => {
                        const key = `${s.lang}::${s.title}`;
                        return (
                          <button
                            key={key}
                            type="button"
                            onClick={() => handleSuggestion(s)}
                            className="flex items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-3 py-1 text-xs font-medium text-zinc-700 hover:border-zinc-900 hover:text-zinc-900 transition-colors"
                          >
                            {s.title}
                            {s.count > 1 && (
                              <span className="text-[10px] font-medium rounded-full px-1 tabular-nums bg-zinc-100 text-zinc-400">
                                {s.count}
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                    {sortedSuggestions.length > frontierLimit && (
                      <button
                        onClick={() => setFrontierLimit((n) => n + 20)}
                        className="text-xs font-medium text-zinc-400 hover:text-zinc-900 transition-colors"
                      >
                        Load 20 more ({sortedSuggestions.length - frontierLimit} remaining)
                      </button>
                    )}
                  </div>
                )}
              </div>

            </div>
          )}

          {/* ── MANAGE ───────────────────────────────────────────────────── */}
          {section === "manage" && (
            <div className="max-w-3xl space-y-4 animate-fade-in">
              <div>
                <h2 className="text-base font-semibold text-zinc-900 mb-0.5">Manage glossary</h2>
                <p className="text-sm text-zinc-400">Browse and delete concepts</p>
              </div>

              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-zinc-400" />
                  <input
                    type="search"
                    placeholder="Search concepts…"
                    value={manageSearch}
                    onChange={(e) => setManageSearch(e.target.value)}
                    className="w-full rounded-lg border border-zinc-200 bg-white pl-9 pr-4 py-2 text-sm outline-none placeholder:text-zinc-400"
                  />
                </div>
                <select
                  value={manageSort}
                  onChange={(e) => setManageSort(e.target.value as ManageSort)}
                  className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-400 transition-colors text-zinc-600"
                >
                  <option value="date-desc">Newest first</option>
                  <option value="date-asc">Oldest first</option>
                  <option value="links-desc">Most links</option>
                  <option value="links-asc">Least links</option>
                  <option value="title">Title A→Z</option>
                  <option value="lang">Language</option>
                </select>
              </div>

              {loading ? (
                <div className="flex items-center justify-center py-20 text-zinc-400">
                  <Loader2 className="size-5 animate-spin" />
                </div>
              ) : filteredConcepts.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 text-center">
                  <BookOpen className="size-10 text-zinc-200 mb-4" />
                  <p className="text-sm text-zinc-400">
                    {manageSearch ? "No concepts match your search" : "Your glossary is empty"}
                  </p>
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
                        <th className="text-left px-4 py-3 text-xs font-medium text-zinc-400 uppercase tracking-wide hidden md:table-cell w-28">
                          Added
                        </th>
                        <th className="text-right px-4 py-3 text-xs font-medium text-zinc-400 uppercase tracking-wide hidden md:table-cell w-16">
                          Links
                        </th>
                        <th className="w-10" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100">
                      {filteredConcepts.map((c) => (
                        <tr key={c.id} className="group hover:bg-zinc-50 transition-colors">
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2.5">
                              {c.thumbnail && (
                                <img
                                  src={c.thumbnail}
                                  alt=""
                                  className="size-8 rounded object-cover shrink-0 opacity-80 border border-zinc-100"
                                />
                              )}
                              <div className="min-w-0">
                                <Link href={`/concept/${c.slug}`} target="_blank" className="font-medium text-zinc-900 truncate hover:underline">{c.title}</Link>
                                <div className="text-xs text-zinc-400 truncate max-w-xs">
                                  {c.definition.slice(0, 90)}{c.definition.length > 90 ? "…" : ""}
                                </div>
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-md bg-zinc-100 text-zinc-500 uppercase tracking-wide">
                              {c.lang}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-xs text-zinc-400 hidden md:table-cell whitespace-nowrap">
                            {new Date(c.createdAt).toLocaleDateString("en-GB", {
                              day: "2-digit",
                              month: "short",
                              year: "numeric",
                            })}
                          </td>
                          <td className="px-4 py-3 text-xs tabular-nums text-zinc-400 text-right hidden md:table-cell">
                            {c.relatedTitles.length}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center justify-end gap-1">
                              <button
                                onClick={() => void handleRefresh(c.id, c.title)}
                                disabled={refreshingId === c.id}
                                className="rounded-lg p-1.5 text-zinc-400 hover:bg-emerald-50 hover:text-emerald-500 transition-all disabled:opacity-50"
                                aria-label={`Refresh ${c.title}`}
                                title={`Refresh ${c.title}`}
                              >
                                {refreshingId === c.id ? (
                                  <Loader2 className="size-3.5 animate-spin" />
                                ) : (
                                  <RotateCw className="size-3.5" />
                                )}
                              </button>
                              <button
                                onClick={() => {
                                  const confirmed = window.confirm(
                                    `Delete \"${c.title}\" from the glossary?`
                                  );
                                  if (confirmed) void handleDelete(c.id);
                                }}
                                disabled={deletingId === c.id}
                                className="rounded-lg p-1.5 text-zinc-400 hover:bg-red-50 hover:text-red-500 transition-all disabled:opacity-50"
                                aria-label={`Delete ${c.title}`}
                                title={`Delete ${c.title}`}
                              >
                                {deletingId === c.id ? (
                                  <Loader2 className="size-3.5 animate-spin" />
                                ) : (
                                  <Trash2 className="size-3.5" />
                                )}
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="px-4 py-3 border-t border-zinc-100 text-xs text-zinc-400">
                    {filteredConcepts.length} concept{filteredConcepts.length !== 1 ? "s" : ""}
                    {manageSearch ? ` matching "${manageSearch}"` : ""}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── GRAPH ────────────────────────────────────────────────────── */}
          {section === "graph" && (
            <div className="animate-fade-in flex flex-col" style={{ height: "calc(100vh - 160px)" }}>
              <div className="mb-4 shrink-0 flex items-end justify-between">
                <div>
                  <h2 className="text-base font-semibold text-zinc-900 mb-0.5">Connectivity Graph</h2>
                  <p className="text-sm text-zinc-400">
                    Scroll, zoom, pan and click to open
                  </p>
                </div>
                <span className="text-xs text-zinc-400 tabular-nums shrink-0 ml-4">
                  {concepts.reduce((s, c) => s + c.relatedTitles.length, 0) >> 1} edges
                </span>
              </div>
              {loading ? (
                <div className="flex-1 flex items-center justify-center text-zinc-400">
                  <Loader2 className="size-5 animate-spin" />
                </div>
              ) : concepts.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center text-center">
                  <Network className="size-10 text-zinc-200 mb-4" />
                  <p className="text-sm text-zinc-400">No concepts yet — add some first</p>
                </div>
              ) : (
                <div className="flex-1 rounded-xl border border-zinc-200 overflow-hidden bg-white min-h-0">
                  <ConceptGraphExplorer concepts={concepts} maxNodes={graphMaxNodes} />
                </div>
              )}
            </div>
          )}

          {/* ── SETTINGS ─────────────────────────────────────────────────── */}
          {section === "settings" && (
            <div className="max-w-2xl space-y-6 animate-fade-in">
              <div>
                <h2 className="text-base font-semibold text-zinc-900 mb-0.5">Settings</h2>
                <p className="text-sm text-zinc-400">Configure behavior</p>
              </div>

              <div className="bg-white rounded-xl border border-zinc-200 p-5 space-y-4">
                <h3 className="text-xs font-medium text-zinc-400 uppercase tracking-wide">
                  Ranking Function
                </h3>
                <label className="flex items-start gap-3 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-3">
                  <input
                    type="checkbox"
                    checked={randomRankingDraft}
                    onChange={(e) => setRandomRankingDraft(e.target.checked)}
                    className="mt-0.5 size-4 rounded border-zinc-300 text-zinc-900 focus:ring-zinc-500"
                  />
                  <div className="space-y-1">
                    <span className="block text-sm font-medium text-zinc-900">Random ranking bypass</span>
                    <span className="block text-xs text-zinc-500">
                      Ignore the ranking function and show concepts in a random order on the main page.
                    </span>
                  </div>
                </label>
                <form onSubmit={handleSaveSettings} className="space-y-4">

                  <div className="space-y-2">
                    <label className="block text-sm font-medium text-zinc-900">
                      In-Degree Weight
                    </label>
                    <div className="flex items-center gap-4">
                      <input
                        type="range"
                        min="-1"
                        max="1"
                        step="0.001"
                        value={inDegreeWeightDraft}
                        onChange={(e) => setInDegreeWeightDraft(e.target.value)}
                        disabled={randomRankingDraft}
                        className="flex-1 disabled:opacity-40"
                      />
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          step="0.001"
                          value={inDegreeWeightDraft}
                          onChange={(e) => setInDegreeWeightDraft(e.target.value)}
                          disabled={randomRankingDraft}
                          className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm w-20 outline-none focus:border-zinc-400 focus:bg-white transition-colors disabled:opacity-40"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="block text-sm font-medium text-zinc-900">
                      Out-Degree Weight
                    </label>
                    <div className="flex items-center gap-4">
                      <input
                        type="range"
                        min="-1"
                        max="1"
                        step="0.001"
                        value={outDegreeWeightDraft}
                        onChange={(e) => setOutDegreeWeightDraft(e.target.value)}
                        disabled={randomRankingDraft}
                        className="flex-1 disabled:opacity-40"
                      />
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          step="0.001"
                          value={outDegreeWeightDraft}
                          onChange={(e) => setOutDegreeWeightDraft(e.target.value)}
                          disabled={randomRankingDraft}
                          className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm w-20 outline-none focus:border-zinc-400 focus:bg-white transition-colors disabled:opacity-40"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="block text-sm font-medium text-zinc-900">
                      Homepage page size
                    </label>
                    <div className="flex items-center gap-3">
                      <input
                        type="number"
                        min="1"
                        step="1"
                        value={homepagePageSizeDraft}
                        onChange={(e) => setHomepagePageSizeDraft(e.target.value)}
                        className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm w-24 outline-none focus:border-zinc-400 focus:bg-white transition-colors"
                      />
                      <span className="text-xs text-zinc-400">concepts shown initially, then load more</span>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="block text-sm font-medium text-zinc-900">
                      Graph max nodes
                    </label>
                    <div className="flex items-center gap-3">
                      <input
                        type="number"
                        min="1"
                        step="1"
                        value={graphMaxNodesDraft ?? ""}
                        disabled={graphMaxNodesDraft === null}
                        onChange={(e) => setGraphMaxNodesDraft(Math.max(1, parseInt(e.target.value, 10) || 1))}
                        className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm w-24 outline-none focus:border-zinc-400 focus:bg-white transition-colors disabled:opacity-40"
                      />
                      <label className="flex items-center gap-2 text-xs text-zinc-500 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={graphMaxNodesDraft === null}
                          onChange={(e) => setGraphMaxNodesDraft(e.target.checked ? null : (graphMaxNodes ?? 1000))}
                          className="size-3.5 rounded border-zinc-300"
                        />
                        No limit
                      </label>
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={savingSettings}
                    className="flex items-center gap-1.5 rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 transition-colors"
                  >
                    {savingSettings ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Check className="size-4" />
                    )}
                    {savingSettings ? "Saving…" : "Save"}
                  </button>
                </form>
                {settingsError && (
                  <p className="flex items-center gap-1.5 text-xs text-red-500">
                    <X className="size-3.5 shrink-0" /> {settingsError}
                  </p>
                )}
                {settingsSuccess && (
                  <p className="flex items-center gap-1.5 text-xs text-emerald-600">
                    <Check className="size-3.5 shrink-0" /> {settingsSuccess}
                  </p>
                )}
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
