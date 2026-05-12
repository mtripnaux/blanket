"use client";

import { useState, useEffect, useCallback, useMemo, Fragment } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Plus, Trash2, Loader2, ArrowRight, BookOpen, LogOut,
  Search, X, Check, Upload, Globe, BarChart3, Lock,
  ArrowUpDown, Hash, Network, RotateCw, Settings,
  ChevronDown, ChevronRight, Clock, Download,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { Concept } from "@/lib/store";
import ConceptGraphExplorer from "@/components/ConceptGraphExplorer";

type Section = "overview" | "add" | "manage" | "graph" | "settings";
type Suggestion = { title: string; lang: string; count: number; score: number; recentCount: number };
type SortOrder = "connections" | "alpha" | "recent";
type ManageSort = "date-desc" | "date-asc" | "title" | "lang" | "links-desc" | "links-asc";
type BulkResult = {
  url: string;
  status: "success" | "error" | "duplicate" | "pending";
  message?: string;
  title?: string;
};

const ADMIN_SECTIONS: Section[] = ["overview", "add", "manage", "graph", "settings"];
const SHORTCUT_MAP: Record<string, Section> = {
  "1": "overview", "2": "add", "3": "manage", "4": "graph", "5": "settings",
};

function getSectionFromPathname(pathname: string): Section {
  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] !== "admin") return "add";
  const section = parts[1];
  if (section && ADMIN_SECTIONS.includes(section as Section)) return section as Section;
  return "add";
}

function sectionHref(s: Section): string {
  return s === "add" ? "/admin" : `/admin/${s}`;
}

function relativeDate(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

function computeSuggestions(
  concepts: Concept[],
  langFilter: string,
  minCount: number,
  recentTitles: Set<string> = new Set()
): Suggestion[] {
  const existing = new Set(concepts.map((c) => c.title.toLowerCase()));
  const counts = new Map<string, Suggestion>();
  for (const concept of concepts) {
    const isRecent = recentTitles.has(concept.title.toLowerCase());
    for (const title of concept.relatedTitles) {
      if (existing.has(title.toLowerCase())) continue;
      if (langFilter !== "all" && concept.lang !== langFilter) continue;
      const key = `${concept.lang}::${title.toLowerCase()}`;
      const weight = 1 + Math.log1p(concept.relatedTitles.length / 100);
      const entry = counts.get(key);
      if (entry) {
        entry.count++;
        entry.score += weight;
        if (isRecent) entry.recentCount++;
      } else {
        counts.set(key, { title, lang: concept.lang, count: 1, score: weight, recentCount: isRecent ? 1 : 0 });
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

  const edgeSet = new Set<string>();
  const directedSet = new Set<string>();
  const degree = new Int32Array(N);

  concepts.forEach((c, i) => {
    for (const t of c.relatedTitles) {
      const j = titleIdx.get(t.toLowerCase());
      if (j === undefined || j === i) continue;
      directedSet.add(`${i}→${j}`);
      const key = `${Math.min(i, j)}-${Math.max(i, j)}`;
      if (!edgeSet.has(key)) { edgeSet.add(key); degree[i]++; degree[j]++; }
    }
  });

  const E = edgeSet.size;
  const degArr = Array.from(degree);
  const avgDegree = (2 * E) / N;
  const density = (2 * E) / (N * (N - 1));

  let maxDeg = 0, maxIdx = 0;
  for (let i = 0; i < N; i++) if (degree[i] > maxDeg) { maxDeg = degree[i]; maxIdx = i; }

  const isolated = degArr.filter((d) => d === 0).length;

  let mutual = 0;
  Array.from(directedSet).forEach((e) => {
    const [a, b] = e.split("→");
    if (directedSet.has(`${b}→${a}`)) mutual++;
  });
  const reciprocity = directedSet.size > 0 ? mutual / directedSet.size : 0;

  const sorted = [...degArr].sort((a, b) => a - b);
  const totalDeg = sorted.reduce((s, d) => s + d, 0);
  let giniNum = 0;
  for (let i = 0; i < N; i++) giniNum += (2 * (i + 1) - N - 1) * sorted[i];
  const gini = totalDeg > 0 ? giniNum / (N * totalDeg) : 0;

  const degCount = new Map<number, number>();
  for (const d of degArr) degCount.set(d, (degCount.get(d) ?? 0) + 1);
  let entropy = 0;
  Array.from(degCount.values()).forEach((cnt) => { const p = cnt / N; entropy -= p * Math.log2(p); });
  const maxEntropy = Math.log2(N);

  const adj: number[][] = Array.from({ length: N }, () => []);
  Array.from(edgeSet).forEach((key) => {
    const dash = key.indexOf("-");
    const a = +key.slice(0, dash), b = +key.slice(dash + 1);
    adj[a].push(b); adj[b].push(a);
  });
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

  const bins = 8;
  const hist = new Array(bins).fill(0);
  const maxD = maxDeg || 1;
  for (const d of degArr) {
    if (d === 0) continue;
    hist[Math.min(bins - 1, Math.floor((d / maxD) * bins))]++;
  }

  return {
    N, E, avgDegree, density, maxDeg, maxHub: concepts[maxIdx].title,
    isolated, reciprocity, gini, entropy, maxEntropy,
    components, largestComponent, clustering, hist, maxD,
  };
}

export default function AdminPage() {
  const pathname = usePathname();
  const router = useRouter();

  const [mounted, setMounted] = useState(false);
  const [auth, setAuth] = useState(false);
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [section, setSection] = useState<Section>("add");
  const [concepts, setConcepts] = useState<Concept[]>([]);
  const [loading, setLoading] = useState(false);

  // Add / import
  const [importUrls, setImportUrls] = useState("");
  const [adding, setAdding] = useState(false);
  const [bulkResults, setBulkResults] = useState<BulkResult[]>([]);
  const [frontierLimit, setFrontierLimit] = useState(20);
  const [langFilter, setLangFilter] = useState("all");
  const [minCount, setMinCount] = useState(1);
  const [sortOrder, setSortOrder] = useState<SortOrder>("connections");
  const [frontierSearch, setFrontierSearch] = useState("");
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [dismissed, setDismissed] = useState<Set<string>>(() => {
    if (typeof window === "undefined") return new Set();
    try {
      const raw = localStorage.getItem("frontier_dismissed");
      return new Set(raw ? JSON.parse(raw) : []);
    } catch { return new Set(); }
  });

  // Manage
  const [manageSearch, setManageSearch] = useState("");
  const [manageSort, setManageSort] = useState<ManageSort>("date-desc");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [refreshingId, setRefreshingId] = useState<string | null>(null);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const [expandedConceptId, setExpandedConceptId] = useState<string | null>(null);

  // Settings
  const [randomRanking, setRandomRanking] = useState(false);
  const [inDegreeWeight, setInDegreeWeight] = useState(0);
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
    const next = getSectionFromPathname(pathname);
    setSection((prev) => (prev === next ? prev : next));
    setConfirmingDeleteId(null);
    setExpandedConceptId(null);
  }, [pathname]);

  // Keyboard shortcuts: 1–5 to switch sections
  useEffect(() => {
    if (!auth || !mounted) return;
    const handler = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
      const target = SHORTCUT_MAP[e.key];
      if (target) { e.preventDefault(); router.push(sectionHref(target)); }
      if (e.key === "Escape") setConfirmingDeleteId(null);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [auth, mounted, router]);

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
      const r = Boolean(data.randomRanking ?? false);
      const ind = data.inDegreeWeight ?? 0;
      const outd = data.outDegreeWeight ?? 0;
      const ps = data.homepagePageSize ?? 50;
      const gmn = "graphMaxNodes" in data ? data.graphMaxNodes : 1000;
      setRandomRanking(r); setRandomRankingDraft(r);
      setInDegreeWeight(ind); setInDegreeWeightDraft(ind.toString());
      setOutDegreeWeight(outd); setOutDegreeWeightDraft(outd.toString());
      setHomepagePageSize(ps); setHomepagePageSizeDraft(ps.toString());
      setGraphMaxNodes(gmn); setGraphMaxNodesDraft(gmn);
    } catch { /* use defaults */ }
  }, []);

  useEffect(() => { if (auth) { fetchConcepts(); fetchSettings(); } }, [auth, fetchConcepts, fetchSettings]);

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
      if (res.ok) { sessionStorage.setItem("blanket_admin_auth", "1"); setAuth(true); }
      else { setAuthError("Invalid password"); setPassword(""); }
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
    const statuses: BulkResult[] = lines.map((u) => ({ url: u, status: "pending" }));
    setBulkResults(statuses);
    for (let i = 0; i < lines.length; i++) {
      const result = await importUrl(lines[i]);
      const status = result.ok ? "success" : result.error === "Already in glossary" ? "duplicate" : "error";
      statuses[i] = { url: lines[i], status, message: result.error, title: result.title };
      setBulkResults([...statuses]);
    }
    const failedUrls = lines.filter((_, i) => statuses[i]?.status === "error");
    setImportUrls(failedUrls.join("\n"));
    setAdding(false);
  }

  function dismissSuggestion(key: string) {
    const next = new Set(dismissed).add(key);
    setDismissed(next);
    try { localStorage.setItem("frontier_dismissed", JSON.stringify(Array.from(next))); } catch {}
    setSelectedKeys((prev) => { const n = new Set(prev); n.delete(key); return n; });
  }

  function clearDismissed() {
    setDismissed(new Set());
    try { localStorage.removeItem("frontier_dismissed"); } catch {}
  }

  function toggleSelect(key: string) {
    setSelectedKeys((prev) => {
      const n = new Set(prev);
      if (n.has(key)) n.delete(key); else n.add(key);
      return n;
    });
  }

  function handleBatchAdd() {
    const urls = Array.from(selectedKeys).flatMap((key) => {
      const s = sortedSuggestions.find((s) => `${s.lang}::${s.title}` === key);
      return s ? [`https://${s.lang}.wikipedia.org/wiki/${encodeURIComponent(s.title.replace(/ /g, "_"))}`] : [];
    });
    setImportUrls((prev) => (prev.trim() ? prev.trimEnd() + "\n" + urls.join("\n") : urls.join("\n")));
    setSelectedKeys(new Set());
  }

  async function handleDelete(id: string) {
    setDeletingId(id);
    try {
      const res = await fetch(`/api/concepts/${id}`, { method: "DELETE" });
      if (res.ok) setConcepts((prev) => prev.filter((c) => c.id !== id));
    } finally {
      setDeletingId(null);
      setConfirmingDeleteId(null);
    }
  }

  async function handleRefresh(id: string, title: string) {
    setRefreshingId(id);
    try {
      const res = await fetch(`/api/concepts/${id}`, { method: "PATCH" });
      const data = await res.json();
      if (!res.ok) { window.alert(data.error || `Could not refresh ${title}`); return; }
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
        body: JSON.stringify({
          randomRanking: randomRankingDraft,
          inDegreeWeight: finalInDegree,
          outDegreeWeight: finalOutDegree,
          homepagePageSize: finalPageSize,
          graphMaxNodes: finalGraphMaxNodes,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setSettingsError(data.error || "Error saving settings"); return; }
      const gmn = "graphMaxNodes" in data ? data.graphMaxNodes : 1000;
      setRandomRanking(Boolean(data.randomRanking)); setRandomRankingDraft(Boolean(data.randomRanking));
      setInDegreeWeight(data.inDegreeWeight); setInDegreeWeightDraft(data.inDegreeWeight.toString());
      setOutDegreeWeight(data.outDegreeWeight); setOutDegreeWeightDraft(data.outDegreeWeight.toString());
      setHomepagePageSize(data.homepagePageSize ?? 50); setHomepagePageSizeDraft((data.homepagePageSize ?? 50).toString());
      setGraphMaxNodes(gmn); setGraphMaxNodesDraft(gmn);
      setSettingsSuccess("Settings saved");
      setTimeout(() => setSettingsSuccess(""), 3000);
    } catch {
      setSettingsError("Could not save settings");
    } finally {
      setSavingSettings(false);
    }
  }

  function handleExport() {
    const blob = new Blob([JSON.stringify(concepts, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `blanket-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ── Derived state (memoized) ─────────────────────────────────────────────────
  const langs = useMemo(() => Array.from(new Set(concepts.map((c) => c.lang))).sort(), [concepts]);

  const recentTitles = useMemo(() => {
    const sorted = [...concepts].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return new Set(sorted.slice(0, 20).map((c) => c.title.toLowerCase()));
  }, [concepts]);

  const queuedTitles = useMemo(() => new Set(
    importUrls.split("\n").map((l) => {
      const part = l.trim().split("/wiki/")[1];
      if (!part) return "";
      return decodeURIComponent(part).replace(/_/g, " ").toLowerCase();
    }).filter(Boolean)
  ), [importUrls]);

  const rawSuggestions = useMemo(() => computeSuggestions(concepts, langFilter, minCount, recentTitles), [concepts, langFilter, minCount, recentTitles]);
  const sortedSuggestions = useMemo(() =>
    [...rawSuggestions]
      .filter((s) => !dismissed.has(`${s.lang}::${s.title.toLowerCase()}`))
      .sort((a, b) => {
        if (sortOrder === "connections") return b.score - a.score;
        if (sortOrder === "recent") return b.recentCount - a.recentCount || b.score - a.score;
        return a.title.localeCompare(b.title);
      }),
    [rawSuggestions, sortOrder, dismissed]
  );
  const filteredSuggestions = useMemo(() =>
    frontierSearch.trim()
      ? sortedSuggestions.filter((s) => s.title.toLowerCase().includes(frontierSearch.toLowerCase()))
      : sortedSuggestions,
    [sortedSuggestions, frontierSearch]
  );
  const visibleSuggestions = useMemo(() => filteredSuggestions.slice(0, frontierLimit), [filteredSuggestions, frontierLimit]);
  const frontierTotal = useMemo(() => computeSuggestions(concepts, "all", 1, recentTitles).length, [concepts, recentTitles]);

  const filteredConcepts = useMemo(() =>
    concepts
      .filter((c) =>
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
      }),
    [concepts, manageSearch, manageSort]
  );

  const langStats = useMemo(() =>
    concepts.reduce((acc, c) => { acc[c.lang] = (acc[c.lang] ?? 0) + 1; return acc; }, {} as Record<string, number>),
    [concepts]
  );

  const mostConnected = useMemo(() =>
    [...concepts].sort((a, b) => b.relatedTitles.length - a.relatedTitles.length).slice(0, 5),
    [concepts]
  );

  const recentConcepts = useMemo(() =>
    [...concepts].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 5),
    [concepts]
  );

  const graphStats = useMemo(() => computeGraphStats(concepts), [concepts]);

  const urlCount = useMemo(() => importUrls.split("\n").filter((l) => l.trim()).length, [importUrls]);

  const importProgress = useMemo(() => {
    if (!bulkResults.length) return null;
    return {
      done: bulkResults.filter((r) => r.status !== "pending").length,
      total: bulkResults.length,
      success: bulkResults.filter((r) => r.status === "success").length,
      errors: bulkResults.filter((r) => r.status === "error").length,
      dupes: bulkResults.filter((r) => r.status === "duplicate").length,
    };
  }, [bulkResults]);

  const settingsDirty = useMemo(() =>
    randomRankingDraft !== randomRanking ||
    Math.abs((parseFloat(inDegreeWeightDraft) || 0) - inDegreeWeight) > 0.0001 ||
    Math.abs((parseFloat(outDegreeWeightDraft) || 0) - outDegreeWeight) > 0.0001 ||
    (parseInt(homepagePageSizeDraft, 10) || 50) !== homepagePageSize ||
    graphMaxNodesDraft !== graphMaxNodes,
    [randomRankingDraft, randomRanking, inDegreeWeightDraft, inDegreeWeight, outDegreeWeightDraft, outDegreeWeight, homepagePageSizeDraft, homepagePageSize, graphMaxNodesDraft, graphMaxNodes]
  );

  if (!mounted) return null;

  // ── Password gate ────────────────────────────────────────────────────────────
  if (!auth) {
    return (
      <div className="min-h-screen bg-zinc-50 flex items-center justify-center p-4">
        <div className="w-full max-w-sm">
          <div className="mb-8 text-center">
            <div className="inline-flex items-center gap-2 mb-2">
              <span className="text-xl font-semibold tracking-tight">blanket</span>
              <span className="text-sm font-medium text-zinc-400">admin</span>
            </div>
            <p className="text-xs text-zinc-400">Enter your password to continue</p>
          </div>
          <form onSubmit={handleLogin} className="bg-white rounded-xl border border-zinc-200 p-6 space-y-4 shadow-sm">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-zinc-500 uppercase tracking-wide">Password</label>
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

  // ── Admin shell ──────────────────────────────────────────────────────────────
  const navItems: { id: Section; label: string; icon: React.ReactNode; shortcut: string; badge?: string; dot?: boolean }[] = [
    { id: "overview", label: "Overview",     icon: <BarChart3 className="size-4" />, shortcut: "1" },
    { id: "add",      label: "Add concepts", icon: <Plus className="size-4" />,      shortcut: "2" },
    { id: "manage",   label: "Manage",       icon: <BookOpen className="size-4" />,  shortcut: "3", badge: concepts.length > 0 ? String(concepts.length) : undefined },
    { id: "graph",    label: "Graph",        icon: <Network className="size-4" />,   shortcut: "4" },
    { id: "settings", label: "Settings",     icon: <Settings className="size-4" />,  shortcut: "5", dot: settingsDirty },
  ];

  return (
    <div className="min-h-screen bg-zinc-50 flex flex-col">
      {/* Top bar */}
      <header className="bg-white border-b border-zinc-200 px-5 h-12 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <Link href="/" className="text-sm font-semibold tracking-tight text-zinc-900 hover:text-zinc-500 transition-colors">
            blanket
          </Link>
          <span className="text-zinc-300">/</span>
          <span className="text-sm text-zinc-400">admin</span>
        </div>
        <div className="flex items-center gap-3">
          {loading && <Loader2 className="size-3.5 text-zinc-400 animate-spin" />}
          <span className="text-xs text-zinc-400 tabular-nums">
            {concepts.length} concept{concepts.length !== 1 ? "s" : ""}
          </span>
          <div className="h-3.5 w-px bg-zinc-200" />
          <button
            onClick={handleLogout}
            className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 transition-colors"
          >
            <LogOut className="size-3.5" />
            Logout
          </button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <nav className="w-48 bg-white border-r border-zinc-200 p-2.5 space-y-0.5 shrink-0 flex flex-col">
          <div className="flex-1 space-y-0.5">
            {navItems.map((item) => (
              <Link
                key={item.id}
                href={sectionHref(item.id)}
                className={cn(
                  "group w-full flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                  section === item.id
                    ? "bg-zinc-900 text-white"
                    : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900"
                )}
              >
                {item.icon}
                <span className="flex-1 truncate">{item.label}</span>
                {item.dot && section !== item.id && (
                  <span className="size-1.5 rounded-full bg-amber-400 shrink-0" />
                )}
                {item.badge && (
                  <span className={cn(
                    "text-[10px] tabular-nums rounded-md px-1.5 py-0.5 font-medium shrink-0",
                    section === item.id ? "bg-white/20 text-white" : "bg-zinc-100 text-zinc-400"
                  )}>
                    {item.badge}
                  </span>
                )}
                {!item.badge && !item.dot && (
                  <span className={cn(
                    "text-[10px] tabular-nums font-mono opacity-0 group-hover:opacity-100 transition-opacity shrink-0",
                    section === item.id ? "text-white/40" : "text-zinc-300"
                  )}>
                    {item.shortcut}
                  </span>
                )}
              </Link>
            ))}
          </div>
          <div className="pt-2 border-t border-zinc-100">
            <Link href="/" className="w-full flex items-center gap-2 px-3 py-2 text-xs text-zinc-400 hover:text-zinc-700 transition-colors rounded-lg hover:bg-zinc-50">
              <ArrowRight className="size-3 rotate-180 shrink-0" />
              Back to site
            </Link>
          </div>
        </nav>

        {/* Content */}
        <main className="flex-1 overflow-y-auto p-6">

          {/* ── OVERVIEW ──────────────────────────────────────────────────── */}
          {section === "overview" && (
            <div className="max-w-2xl space-y-5 animate-fade-in">
              <div>
                <h2 className="text-base font-semibold text-zinc-900">Overview</h2>
                <p className="text-sm text-zinc-400 mt-0.5">Your knowledge graph at a glance</p>
              </div>

              {loading ? (
                <div className="flex items-center justify-center py-24 text-zinc-400">
                  <Loader2 className="size-5 animate-spin" />
                </div>
              ) : <>

              {/* KPI row */}
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: "Concepts", value: concepts.length, sub: `${langs.join(", ") || "—"}` },
                  { label: "Languages", value: langs.length, sub: langs.length === 1 ? "language" : "languages" },
                  { label: "Frontier", value: frontierTotal, sub: "to discover" },
                ].map(({ label, value, sub }) => (
                  <div key={label} className="bg-white rounded-xl border border-zinc-200 p-4 space-y-1">
                    <p className="text-xs font-medium text-zinc-400 uppercase tracking-wide">{label}</p>
                    <p className="text-3xl font-semibold tabular-nums text-zinc-900 leading-none">{value}</p>
                    <p className="text-[11px] text-zinc-400 truncate">{sub}</p>
                  </div>
                ))}
              </div>

              {/* Recent additions */}
              {recentConcepts.length > 0 && (
                <div className="bg-white rounded-xl border border-zinc-200 overflow-hidden">
                  <div className="px-5 py-3.5 border-b border-zinc-100 flex items-center gap-2">
                    <Clock className="size-3.5 text-zinc-400" />
                    <h3 className="text-xs font-medium text-zinc-400 uppercase tracking-wide">Recent additions</h3>
                  </div>
                  <ul className="divide-y divide-zinc-100">
                    {recentConcepts.map((c) => (
                      <li key={c.id} className="flex items-center gap-3 px-5 py-3 hover:bg-zinc-50 transition-colors">
                        {c.thumbnail ? (
                          <img src={c.thumbnail} alt="" className="size-8 rounded object-cover shrink-0 opacity-80 border border-zinc-100" />
                        ) : (
                          <div className="size-8 rounded bg-zinc-100 shrink-0 flex items-center justify-center">
                            <BookOpen className="size-3.5 text-zinc-300" />
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <Link href={`/concept/${c.slug}`} target="_blank" className="text-sm font-medium text-zinc-900 hover:underline truncate block">
                            {c.title}
                          </Link>
                          <p className="text-[11px] text-zinc-400 truncate">{c.definition.slice(0, 80)}{c.definition.length > 80 ? "…" : ""}</p>
                        </div>
                        <span className="text-[11px] text-zinc-400 shrink-0 tabular-nums">{relativeDate(c.createdAt)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {graphStats && (
                <>
                  {/* Network topology */}
                  <div className="bg-white rounded-xl border border-zinc-200 overflow-hidden">
                    <div className="px-5 py-3.5 border-b border-zinc-100">
                      <h3 className="text-xs font-medium text-zinc-400 uppercase tracking-wide">Network topology</h3>
                    </div>
                    <div className="p-5 grid grid-cols-2 gap-x-8 gap-y-3">
                      {[
                        { label: "Edges", value: graphStats.E.toLocaleString() },
                        { label: "Avg degree", value: graphStats.avgDegree.toFixed(1) },
                        { label: "Density", value: `${(graphStats.density * 100).toFixed(3)}%` },
                        { label: "Max degree", value: `${graphStats.maxDeg} — ${graphStats.maxHub}`, mono: false },
                        { label: "Isolated nodes", value: graphStats.isolated },
                        { label: "Reciprocity", value: `${(graphStats.reciprocity * 100).toFixed(1)}%` },
                        { label: "Components", value: graphStats.components },
                        { label: "Largest component", value: `${graphStats.largestComponent} nodes` },
                        { label: "Avg clustering", value: graphStats.clustering.toFixed(3) },
                        { label: "Gini coefficient", value: graphStats.gini.toFixed(3) },
                      ].map(({ label, value, mono = true }) => (
                        <div key={label} className="flex items-baseline justify-between gap-2 border-b border-zinc-50 pb-2 last:border-0">
                          <span className="text-xs text-zinc-400 shrink-0">{label}</span>
                          <span className={cn("text-xs font-medium text-zinc-800 text-right truncate", mono && "tabular-nums")}>
                            {value}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Degree distribution */}
                  <div className="bg-white rounded-xl border border-zinc-200 overflow-hidden">
                    <div className="px-5 py-3.5 border-b border-zinc-100 flex items-center justify-between">
                      <h3 className="text-xs font-medium text-zinc-400 uppercase tracking-wide">Degree distribution</h3>
                      <span className="text-[11px] text-zinc-400 tabular-nums">
                        {graphStats.entropy.toFixed(2)} / {graphStats.maxEntropy.toFixed(2)} bits entropy
                      </span>
                    </div>
                    <div className="p-5 space-y-3">
                      <div className="flex items-end gap-1 h-16">
                        {graphStats.hist.map((count, i) => {
                          const peak = Math.max(...graphStats.hist);
                          const low = Math.round((i / graphStats.hist.length) * graphStats.maxD);
                          const high = Math.round(((i + 1) / graphStats.hist.length) * graphStats.maxD);
                          return (
                            <div key={i} className="flex-1 flex flex-col items-center gap-1 group relative">
                              <div
                                className="w-full bg-zinc-200 group-hover:bg-zinc-900 rounded-sm transition-colors"
                                style={{ height: peak > 0 ? `${Math.max(4, (count / peak) * 56)}px` : "4px" }}
                              />
                              <div className="absolute bottom-full mb-1.5 hidden group-hover:block bg-zinc-900 text-white text-[10px] rounded-md px-2 py-1 whitespace-nowrap z-10 pointer-events-none">
                                deg {low}–{high}: {count} node{count !== 1 ? "s" : ""}
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
                  </div>
                </>
              )}

              {/* By language */}
              {Object.keys(langStats).length > 0 && (
                <div className="bg-white rounded-xl border border-zinc-200 overflow-hidden">
                  <div className="px-5 py-3.5 border-b border-zinc-100">
                    <h3 className="text-xs font-medium text-zinc-400 uppercase tracking-wide">By language</h3>
                  </div>
                  <div className="p-5 space-y-2.5">
                    {Object.entries(langStats)
                      .sort((a, b) => b[1] - a[1])
                      .map(([lang, count]) => (
                        <div key={lang} className="flex items-center gap-3">
                          <span className="text-xs font-medium text-zinc-500 uppercase w-7 shrink-0">{lang}</span>
                          <div className="flex-1 bg-zinc-100 rounded-full h-1.5 overflow-hidden">
                            <div
                              className="bg-zinc-900 h-1.5 rounded-full transition-all duration-500"
                              style={{ width: `${(count / concepts.length) * 100}%` }}
                            />
                          </div>
                          <span className="text-xs tabular-nums text-zinc-400 w-6 text-right">{count}</span>
                        </div>
                      ))}
                  </div>
                </div>
              )}

              {/* Most connected */}
              {mostConnected.length > 0 && (
                <div className="bg-white rounded-xl border border-zinc-200 overflow-hidden">
                  <div className="px-5 py-3.5 border-b border-zinc-100">
                    <h3 className="text-xs font-medium text-zinc-400 uppercase tracking-wide">Most connected</h3>
                  </div>
                  <ul className="divide-y divide-zinc-100">
                    {mostConnected.map((c, i) => (
                      <li key={c.id} className="flex items-center gap-3 px-5 py-3 hover:bg-zinc-50 transition-colors">
                        <span className="text-xs tabular-nums text-zinc-300 w-4 shrink-0">{i + 1}</span>
                        <Link href={`/concept/${c.slug}`} target="_blank" className="flex-1 text-sm font-medium text-zinc-900 hover:underline truncate">
                          {c.title}
                        </Link>
                        <span className="text-xs tabular-nums text-zinc-400 shrink-0">{c.relatedTitles.length} links</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              </>}
            </div>
          )}

          {/* ── ADD ───────────────────────────────────────────────────────── */}
          {section === "add" && (
            <div className="max-w-2xl space-y-5 animate-fade-in">
              <div>
                <h2 className="text-base font-semibold text-zinc-900">Add concepts</h2>
                <p className="text-sm text-zinc-400 mt-0.5">Import from Wikipedia or explore your knowledge frontier</p>
              </div>

              {/* Import card */}
              <div className="bg-white rounded-xl border border-zinc-200 overflow-hidden">
                <div className="px-5 py-3.5 border-b border-zinc-100 flex items-center justify-between">
                  <h3 className="text-xs font-medium text-zinc-400 uppercase tracking-wide">Import from Wikipedia</h3>
                  {urlCount > 0 && (
                    <span className="text-[11px] tabular-nums text-zinc-400">
                      {urlCount} URL{urlCount !== 1 ? "s" : ""}
                    </span>
                  )}
                </div>
                <div className="p-5 space-y-4">
                  <form onSubmit={handleImport} className="space-y-3">
                    <textarea
                      value={importUrls}
                      onChange={(e) => setImportUrls(e.target.value)}
                      placeholder={"https://en.wikipedia.org/wiki/Photosynthesis\nhttps://en.wikipedia.org/wiki/Entropy\nhttps://fr.wikipedia.org/wiki/Complexité"}
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
                        {adding ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
                        {adding ? "Importing…" : "Import"}
                      </button>
                      {importProgress && (
                        <span className="text-xs text-zinc-400 tabular-nums">
                          {importProgress.done}/{importProgress.total}
                          {importProgress.success > 0 && <span className="text-emerald-500 ml-1.5">+{importProgress.success}</span>}
                          {importProgress.errors > 0 && <span className="text-red-500 ml-1">·{importProgress.errors} failed</span>}
                          {importProgress.dupes > 0 && <span className="text-amber-500 ml-1">·{importProgress.dupes} dup</span>}
                        </span>
                      )}
                      {bulkResults.length > 0 && !adding && (
                        <button
                          type="button"
                          onClick={() => { setBulkResults([]); setImportUrls(""); }}
                          className="ml-auto text-xs text-zinc-400 hover:text-zinc-700 transition-colors"
                        >
                          Clear
                        </button>
                      )}
                    </div>
                  </form>

                  {bulkResults.length > 0 && (
                    <>
                      {importProgress && importProgress.total > 1 && (
                        <div className="h-1 bg-zinc-100 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-zinc-900 rounded-full transition-all duration-300"
                            style={{ width: `${(importProgress.done / importProgress.total) * 100}%` }}
                          />
                        </div>
                      )}
                      <ul className="space-y-1.5 border-t border-zinc-100 pt-3">
                        {bulkResults.map((r, i) => (
                          <li key={i} className="flex items-center gap-2 text-xs">
                            {r.status === "pending" && <Loader2 className="size-3.5 text-zinc-400 animate-spin shrink-0" />}
                            {r.status === "success" && <Check className="size-3.5 text-emerald-500 shrink-0" />}
                            {r.status === "duplicate" && <span className="text-amber-500 shrink-0 font-bold leading-none text-sm">≈</span>}
                            {r.status === "error" && <X className="size-3.5 text-red-500 shrink-0" />}
                            <span className={cn(
                              "truncate",
                              r.status === "success" && "text-zinc-700",
                              r.status === "duplicate" && "text-amber-600",
                              r.status === "error" && "text-red-500",
                              r.status === "pending" && "text-zinc-400",
                            )}>
                              {r.status === "success" ? (r.title ?? r.url) : r.url}
                            </span>
                            {r.message && r.status !== "success" && (
                              <span className="text-zinc-400 shrink-0">— {r.message}</span>
                            )}
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </div>
              </div>

              {/* Frontier Explorer */}
              <div className="bg-white rounded-xl border border-zinc-200 overflow-hidden">
                <div className="px-5 py-3.5 border-b border-zinc-100 flex items-center justify-between">
                  <h3 className="text-xs font-medium text-zinc-400 uppercase tracking-wide">Frontier Explorer</h3>
                  <div className="flex items-center gap-3">
                    {dismissed.size > 0 && (
                      <button type="button" onClick={clearDismissed} className="text-[11px] text-zinc-400 hover:text-zinc-700 transition-colors">
                        {dismissed.size} hidden · restore
                      </button>
                    )}
                    <span className="text-[11px] text-zinc-400 tabular-nums">{sortedSuggestions.length} suggestions</span>
                  </div>
                </div>
                <div className="p-5 space-y-4">
                  {/* Filters */}
                  <div className="flex flex-wrap gap-2">
                    <div className="flex items-center gap-1.5 rounded-lg border border-zinc-200 px-2.5 py-1.5 bg-zinc-50 flex-1 min-w-32">
                      <Search className="size-3.5 text-zinc-400 shrink-0" />
                      <input
                        type="text"
                        placeholder="Filter…"
                        value={frontierSearch}
                        onChange={(e) => { setFrontierSearch(e.target.value); setFrontierLimit(20); }}
                        className="outline-none bg-transparent text-zinc-600 text-xs w-full placeholder:text-zinc-400"
                      />
                      {frontierSearch && (
                        <button type="button" onClick={() => setFrontierSearch("")} className="text-zinc-400 hover:text-zinc-700 transition-colors shrink-0">
                          <X className="size-3" />
                        </button>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 rounded-lg border border-zinc-200 px-2.5 py-1.5 bg-zinc-50">
                      <Globe className="size-3.5 text-zinc-400 shrink-0" />
                      <select value={langFilter} onChange={(e) => { setLangFilter(e.target.value); setFrontierLimit(20); }} className="outline-none bg-transparent text-zinc-600 cursor-pointer text-xs">
                        <option value="all">All languages</option>
                        {langs.map((l) => <option key={l} value={l}>{l.toUpperCase()}</option>)}
                      </select>
                    </div>
                    <div className="flex items-center gap-1.5 rounded-lg border border-zinc-200 px-2.5 py-1.5 bg-zinc-50">
                      <Hash className="size-3.5 text-zinc-400 shrink-0" />
                      <select value={minCount} onChange={(e) => { setMinCount(Number(e.target.value)); setFrontierLimit(20); }} className="outline-none bg-transparent text-zinc-600 cursor-pointer text-xs">
                        {[1, 2, 3, 5, 10].map((n) => <option key={n} value={n}>Min {n} link{n !== 1 ? "s" : ""}</option>)}
                      </select>
                    </div>
                    <div className="flex items-center gap-1.5 rounded-lg border border-zinc-200 px-2.5 py-1.5 bg-zinc-50">
                      <ArrowUpDown className="size-3.5 text-zinc-400 shrink-0" />
                      <select value={sortOrder} onChange={(e) => setSortOrder(e.target.value as SortOrder)} className="outline-none bg-transparent text-zinc-600 cursor-pointer text-xs">
                        <option value="connections">By connections</option>
                        <option value="recent">Recently added</option>
                        <option value="alpha">Alphabetical</option>
                      </select>
                    </div>
                  </div>

                  {/* Chips */}
                  {visibleSuggestions.length === 0 ? (
                    <div className="py-8 text-center">
                      <p className="text-sm text-zinc-400">No suggestions with current filters</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div className="flex flex-wrap gap-1.5">
                        {visibleSuggestions.map((s) => {
                          const key = `${s.lang}::${s.title}`;
                          const isQueued = queuedTitles.has(s.title.toLowerCase());
                          const isSelected = selectedKeys.has(key);
                          return (
                            <div key={key} className="group relative">
                              <button
                                type="button"
                                disabled={isQueued}
                                onClick={() => { if (!isQueued) toggleSelect(key); }}
                                className={cn(
                                  "flex items-center gap-1.5 rounded-full border py-1 text-xs font-medium transition-colors",
                                  isQueued
                                    ? "pl-2.5 pr-3 border-zinc-100 bg-zinc-50 text-zinc-400 cursor-default"
                                    : isSelected
                                    ? "pl-2.5 pr-6 border-zinc-900 bg-zinc-900 text-white"
                                    : "pl-2.5 pr-6 border-zinc-200 bg-white text-zinc-700 hover:border-zinc-900 hover:text-zinc-900"
                                )}
                              >
                                {isQueued
                                  ? <Check className="size-2.5 text-zinc-400 shrink-0" />
                                  : isSelected
                                  ? <Check className="size-2.5 shrink-0" />
                                  : <Plus className="size-2.5 text-zinc-300 group-hover:text-zinc-600 transition-colors shrink-0" />
                                }
                                {s.title}
                                {s.recentCount > 0 && !isQueued && (
                                  <span className={cn("size-1.5 rounded-full shrink-0", isSelected ? "bg-amber-300" : "bg-amber-400")} title={`Linked by ${s.recentCount} recently added concept${s.recentCount > 1 ? "s" : ""}`} />
                                )}
                                {s.count > 1 && (
                                  <span className={cn(
                                    "text-[10px] font-medium rounded-full px-1 tabular-nums",
                                    isSelected ? "bg-white/20 text-white" : "bg-zinc-100 text-zinc-400 group-hover:bg-zinc-200"
                                  )}>
                                    {s.count}
                                  </span>
                                )}
                              </button>
                              {!isQueued && (
                                <button
                                  type="button"
                                  onClick={(e) => { e.stopPropagation(); dismissSuggestion(key); }}
                                  title="Dismiss"
                                  className="absolute right-1.5 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity text-zinc-400 hover:text-zinc-700"
                                >
                                  <X className="size-2.5" />
                                </button>
                              )}
                            </div>
                          );
                        })}
                      </div>
                      <div className="flex items-center justify-between gap-3 min-h-6">
                        <div>
                          {filteredSuggestions.length > frontierLimit && (
                            <button
                              onClick={() => setFrontierLimit((n) => n + 20)}
                              className="flex items-center gap-1 text-xs font-medium text-zinc-400 hover:text-zinc-900 transition-colors"
                            >
                              <ChevronDown className="size-3.5" />
                              Load 20 more ({filteredSuggestions.length - frontierLimit} remaining)
                            </button>
                          )}
                        </div>
                        {selectedKeys.size > 0 && (
                          <div className="flex items-center gap-2 shrink-0">
                            <button
                              type="button"
                              onClick={() => setSelectedKeys(new Set())}
                              className="text-xs text-zinc-400 hover:text-zinc-700 transition-colors"
                            >
                              Clear
                            </button>
                            <button
                              type="button"
                              onClick={handleBatchAdd}
                              className="flex items-center gap-1.5 rounded-lg bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-700 transition-colors"
                            >
                              <Upload className="size-3" />
                              Add {selectedKeys.size} to queue
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ── MANAGE ────────────────────────────────────────────────────── */}
          {section === "manage" && (
            <div className="max-w-3xl space-y-4 animate-fade-in">
              <div className="flex items-end justify-between">
                <div>
                  <h2 className="text-base font-semibold text-zinc-900">Manage</h2>
                  <p className="text-sm text-zinc-400 mt-0.5">Browse, refresh and curate your glossary</p>
                </div>
                {concepts.length > 0 && (
                  <button
                    onClick={handleExport}
                    className="flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900 transition-colors"
                  >
                    <Download className="size-3.5" />
                    Export JSON
                  </button>
                )}
              </div>

              {/* Search + sort */}
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-zinc-400" />
                  <input
                    type="search"
                    placeholder="Search concepts…"
                    value={manageSearch}
                    onChange={(e) => setManageSearch(e.target.value)}
                    className="w-full rounded-lg border border-zinc-200 bg-white pl-9 pr-9 py-2 text-sm outline-none placeholder:text-zinc-400 focus:border-zinc-300 transition-colors"
                  />
                  {manageSearch && (
                    <button
                      onClick={() => setManageSearch("")}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-700 transition-colors"
                    >
                      <X className="size-3.5" />
                    </button>
                  )}
                </div>
                <select
                  value={manageSort}
                  onChange={(e) => setManageSort(e.target.value as ManageSort)}
                  className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm outline-none text-zinc-600 focus:border-zinc-300 transition-colors cursor-pointer"
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
                <div className="flex items-center justify-center py-24 text-zinc-400">
                  <Loader2 className="size-5 animate-spin" />
                </div>
              ) : filteredConcepts.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-24 text-center">
                  <BookOpen className="size-10 text-zinc-200 mb-4" />
                  <p className="text-sm text-zinc-400">
                    {manageSearch ? `No concepts match "${manageSearch}"` : "Your glossary is empty"}
                  </p>
                  {manageSearch && (
                    <button onClick={() => setManageSearch("")} className="mt-2 text-xs text-zinc-400 hover:text-zinc-700 underline transition-colors">
                      Clear search
                    </button>
                  )}
                </div>
              ) : (
                <div className="bg-white rounded-xl border border-zinc-200 overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-zinc-100">
                        <th className="text-left px-4 py-3 text-xs font-medium text-zinc-400 uppercase tracking-wide">Concept</th>
                        <th className="text-left px-4 py-3 text-xs font-medium text-zinc-400 uppercase tracking-wide w-14">Lang</th>
                        <th className="text-left px-4 py-3 text-xs font-medium text-zinc-400 uppercase tracking-wide hidden md:table-cell w-28">Added</th>
                        <th className="text-right px-4 py-3 text-xs font-medium text-zinc-400 uppercase tracking-wide hidden md:table-cell w-16">Links</th>
                        <th className="w-20" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100">
                      {filteredConcepts.map((c) => (
                        <Fragment key={c.id}>
                          <tr
                            key={c.id}
                            className={cn("group transition-colors cursor-pointer", expandedConceptId === c.id ? "bg-zinc-50" : "hover:bg-zinc-50")}
                            onClick={(e) => {
                              if ((e.target as HTMLElement).closest("button, a")) return;
                              setExpandedConceptId(expandedConceptId === c.id ? null : c.id);
                              setConfirmingDeleteId(null);
                            }}
                          >
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-2.5">
                                <ChevronRight className={cn("size-3.5 text-zinc-300 shrink-0 transition-transform", expandedConceptId === c.id && "rotate-90")} />
                                {c.thumbnail && (
                                  <img src={c.thumbnail} alt="" className="size-8 rounded object-cover shrink-0 opacity-80 border border-zinc-100" />
                                )}
                                <div className="min-w-0">
                                  <span className="font-medium text-zinc-900 truncate block">{c.title}</span>
                                  <span className="text-xs text-zinc-400 truncate max-w-xs block">
                                    {c.definition.slice(0, 80)}{c.definition.length > 80 ? "…" : ""}
                                  </span>
                                </div>
                              </div>
                            </td>
                            <td className="px-4 py-3">
                              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-md bg-zinc-100 text-zinc-500 uppercase tracking-wide">
                                {c.lang}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-xs text-zinc-400 hidden md:table-cell whitespace-nowrap">
                              {new Date(c.createdAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
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
                                  title={`Refresh ${c.title}`}
                                >
                                  {refreshingId === c.id ? <Loader2 className="size-3.5 animate-spin" /> : <RotateCw className="size-3.5" />}
                                </button>
                                {confirmingDeleteId === c.id ? (
                                  <div className="flex items-center gap-1">
                                    <button
                                      onClick={() => setConfirmingDeleteId(null)}
                                      className="rounded px-1.5 py-0.5 text-[11px] text-zinc-400 hover:text-zinc-700 transition-colors"
                                    >
                                      Cancel
                                    </button>
                                    <button
                                      onClick={() => void handleDelete(c.id)}
                                      disabled={deletingId === c.id}
                                      className="rounded px-2 py-0.5 text-[11px] font-medium bg-red-50 text-red-500 hover:bg-red-100 transition-colors disabled:opacity-50"
                                    >
                                      {deletingId === c.id ? <Loader2 className="size-3 animate-spin" /> : "Delete"}
                                    </button>
                                  </div>
                                ) : (
                                  <button
                                    onClick={() => { setConfirmingDeleteId(c.id); setExpandedConceptId(null); }}
                                    disabled={deletingId === c.id}
                                    className="rounded-lg p-1.5 text-zinc-400 hover:bg-red-50 hover:text-red-500 transition-all disabled:opacity-50"
                                    title={`Delete ${c.title}`}
                                  >
                                    <Trash2 className="size-3.5" />
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                          {expandedConceptId === c.id && (
                            <tr key={`${c.id}-expanded`} className="bg-zinc-50">
                              <td colSpan={5} className="px-4 pb-4 pt-0">
                                <div className="ml-9 space-y-2">
                                  <p className="text-sm text-zinc-600 leading-relaxed">{c.definition}</p>
                                  <div className="flex items-center gap-3">
                                    <Link
                                      href={c.url}
                                      target="_blank"
                                      className="text-xs text-zinc-400 hover:text-zinc-700 underline transition-colors"
                                    >
                                      Wikipedia →
                                    </Link>
                                    <Link
                                      href={`/concept/${c.slug}`}
                                      target="_blank"
                                      className="text-xs text-zinc-400 hover:text-zinc-700 underline transition-colors"
                                    >
                                      Concept page →
                                    </Link>
                                    <span className="text-xs text-zinc-400">{c.relatedTitles.length} related titles</span>
                                  </div>
                                </div>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      ))}
                    </tbody>
                  </table>
                  <div className="px-4 py-3 border-t border-zinc-100 flex items-center justify-between">
                    <span className="text-xs text-zinc-400">
                      {filteredConcepts.length} concept{filteredConcepts.length !== 1 ? "s" : ""}
                      {manageSearch ? ` matching "${manageSearch}"` : ""}
                    </span>
                    {manageSearch && (
                      <button onClick={() => setManageSearch("")} className="text-xs text-zinc-400 hover:text-zinc-700 transition-colors">
                        Clear search
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── GRAPH ─────────────────────────────────────────────────────── */}
          {section === "graph" && (
            <div className="animate-fade-in flex flex-col" style={{ height: "calc(100vh - 112px)" }}>
              <div className="mb-4 shrink-0 flex items-end justify-between">
                <div>
                  <h2 className="text-base font-semibold text-zinc-900">Connectivity Graph</h2>
                  <p className="text-sm text-zinc-400 mt-0.5">Scroll to zoom, drag to pan, click to open</p>
                </div>
                {concepts.length > 0 && (
                  <span className="text-xs text-zinc-400 tabular-nums">
                    {concepts.length} nodes · {concepts.reduce((s, c) => s + c.relatedTitles.length, 0) >> 1} edges
                  </span>
                )}
              </div>
              {loading ? (
                <div className="flex-1 flex items-center justify-center text-zinc-400">
                  <Loader2 className="size-5 animate-spin" />
                </div>
              ) : concepts.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center text-center">
                  <Network className="size-10 text-zinc-200 mb-4" />
                  <p className="text-sm text-zinc-400">No concepts yet</p>
                  <Link href="/admin" className="mt-2 text-xs text-zinc-400 hover:text-zinc-700 underline transition-colors">Add some first →</Link>
                </div>
              ) : (
                <div className="flex-1 rounded-xl border border-zinc-200 overflow-hidden bg-white min-h-0">
                  <ConceptGraphExplorer concepts={concepts} maxNodes={graphMaxNodes} />
                </div>
              )}
            </div>
          )}

          {/* ── SETTINGS ──────────────────────────────────────────────────── */}
          {section === "settings" && (
            <div className="max-w-2xl space-y-5 animate-fade-in">
              <div className="flex items-end justify-between">
                <div>
                  <h2 className="text-base font-semibold text-zinc-900">Settings</h2>
                  <p className="text-sm text-zinc-400 mt-0.5">Configure ranking and display behavior</p>
                </div>
                {settingsDirty && (
                  <span className="text-[11px] text-amber-500 font-medium">Unsaved changes</span>
                )}
              </div>

              <form onSubmit={handleSaveSettings} className="space-y-5">
                {/* Homepage ranking */}
                <div className="bg-white rounded-xl border border-zinc-200 overflow-hidden">
                  <div className="px-5 py-3.5 border-b border-zinc-100">
                    <h3 className="text-xs font-medium text-zinc-400 uppercase tracking-wide">Homepage ranking</h3>
                  </div>
                  <div className="p-5 space-y-5">
                    <label className="flex items-start gap-3 rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-3 cursor-pointer hover:bg-zinc-100 transition-colors">
                      <input
                        type="checkbox"
                        checked={randomRankingDraft}
                        onChange={(e) => setRandomRankingDraft(e.target.checked)}
                        className="mt-0.5 size-4 rounded border-zinc-300 accent-zinc-900"
                      />
                      <div>
                        <span className="block text-sm font-medium text-zinc-900">Random order</span>
                        <span className="block text-xs text-zinc-500 mt-0.5">
                          Bypass the ranking function and shuffle concepts on every visit.
                        </span>
                      </div>
                    </label>

                    <div className={cn("space-y-4 transition-opacity", randomRankingDraft && "opacity-40 pointer-events-none")}>
                      {[
                        { label: "In-degree weight", desc: "Favor concepts linked to by many others", key: "in" as const, value: inDegreeWeightDraft, set: setInDegreeWeightDraft },
                        { label: "Out-degree weight", desc: "Favor concepts with many outgoing links", key: "out" as const, value: outDegreeWeightDraft, set: setOutDegreeWeightDraft },
                      ].map(({ label, desc, value, set }) => (
                        <div key={label} className="space-y-1.5">
                          <div className="flex items-center justify-between">
                            <div>
                              <span className="text-sm font-medium text-zinc-900">{label}</span>
                              <span className="block text-xs text-zinc-400">{desc}</span>
                            </div>
                            <input
                              type="number"
                              step="0.001"
                              value={value}
                              onChange={(e) => set(e.target.value)}
                              className="rounded-lg border border-zinc-200 bg-zinc-50 px-2.5 py-1.5 text-sm w-20 outline-none focus:border-zinc-400 focus:bg-white transition-colors text-right tabular-nums"
                            />
                          </div>
                          <input
                            type="range"
                            min="-1"
                            max="1"
                            step="0.001"
                            value={value}
                            onChange={(e) => set(e.target.value)}
                            className="w-full accent-zinc-900"
                          />
                          <div className="flex justify-between text-[10px] text-zinc-400">
                            <span>−1 penalize</span>
                            <span>0 neutral</span>
                            <span>+1 boost</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Display */}
                <div className="bg-white rounded-xl border border-zinc-200 overflow-hidden">
                  <div className="px-5 py-3.5 border-b border-zinc-100">
                    <h3 className="text-xs font-medium text-zinc-400 uppercase tracking-wide">Display</h3>
                  </div>
                  <div className="p-5 space-y-4">
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <span className="text-sm font-medium text-zinc-900">Homepage page size</span>
                        <span className="block text-xs text-zinc-400 mt-0.5">Concepts shown before "Load more"</span>
                      </div>
                      <input
                        type="number"
                        min="1"
                        step="1"
                        value={homepagePageSizeDraft}
                        onChange={(e) => setHomepagePageSizeDraft(e.target.value)}
                        className="rounded-lg border border-zinc-200 bg-zinc-50 px-2.5 py-1.5 text-sm w-20 outline-none focus:border-zinc-400 focus:bg-white transition-colors text-right tabular-nums"
                      />
                    </div>

                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <span className="text-sm font-medium text-zinc-900">Graph max nodes</span>
                        <span className="block text-xs text-zinc-400 mt-0.5">Cap for graph rendering performance</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          min="1"
                          step="1"
                          value={graphMaxNodesDraft ?? ""}
                          disabled={graphMaxNodesDraft === null}
                          onChange={(e) => setGraphMaxNodesDraft(Math.max(1, parseInt(e.target.value, 10) || 1))}
                          className="rounded-lg border border-zinc-200 bg-zinc-50 px-2.5 py-1.5 text-sm w-20 outline-none focus:border-zinc-400 focus:bg-white transition-colors text-right tabular-nums disabled:opacity-40"
                        />
                        <label className="flex items-center gap-1.5 text-xs text-zinc-500 cursor-pointer select-none whitespace-nowrap">
                          <input
                            type="checkbox"
                            checked={graphMaxNodesDraft === null}
                            onChange={(e) => setGraphMaxNodesDraft(e.target.checked ? null : (graphMaxNodes ?? 1000))}
                            className="size-3.5 rounded border-zinc-300 accent-zinc-900"
                          />
                          No limit
                        </label>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <button
                    type="submit"
                    disabled={savingSettings}
                    className="flex items-center gap-1.5 rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 transition-colors"
                  >
                    {savingSettings ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
                    {savingSettings ? "Saving…" : "Save settings"}
                  </button>
                  {settingsError && (
                    <span className="flex items-center gap-1.5 text-xs text-red-500">
                      <X className="size-3.5 shrink-0" /> {settingsError}
                    </span>
                  )}
                  {settingsSuccess && (
                    <span className="flex items-center gap-1.5 text-xs text-emerald-600">
                      <Check className="size-3.5 shrink-0" /> {settingsSuccess}
                    </span>
                  )}
                </div>
              </form>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
