"use client";

import { useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import type { Concept } from "@/lib/store";

// ─── Simulation constants ────────────────────────────────────────────────────
const DEFAULT_MAX_NODES = 1000;
const THETA        = 0.8;   // Barnes-Hut accuracy (lower = more exact, slower)
const REPULSION    = 120;
const MAX_FORCE    = 3;
const SPRING_LEN   = 55;
const SPRING_K     = 0.012;
const DAMPING      = 0.72;
const CENTER_PULL  = 0.002;
const VEL_CAP      = 4;
const SETTLE_KE    = 0.08;

type Node = { x: number; y: number; vx: number; vy: number; title: string; slug: string };
type Edge = { s: number; t: number };
type View = { tx: number; ty: number; scale: number };

// ─── Barnes-Hut Quadtree ─────────────────────────────────────────────────────
class QTree {
  x: number; y: number; w: number; h: number;
  cx = 0; cy = 0; mass = 0;
  body = -1;
  children: [QTree, QTree, QTree, QTree] | null = null;

  constructor(x: number, y: number, w: number, h: number) {
    this.x = x; this.y = y; this.w = w; this.h = h;
  }

  insert(idx: number, nx: number, ny: number): void {
    if (this.mass === 0) {
      this.body = idx; this.cx = nx; this.cy = ny; this.mass = 1;
      return;
    }
    if (this.children === null) {
      // Split leaf → internal
      const hw = this.w / 2, hh = this.h / 2;
      this.children = [
        new QTree(this.x,      this.y,      hw, hh),
        new QTree(this.x + hw, this.y,      hw, hh),
        new QTree(this.x,      this.y + hh, hw, hh),
        new QTree(this.x + hw, this.y + hh, hw, hh),
      ];
      this.insertChild(this.body, this.cx, this.cy);
      this.body = -1;
    }
    // Update aggregate center of mass
    const nm = this.mass + 1;
    this.cx = (this.cx * this.mass + nx) / nm;
    this.cy = (this.cy * this.mass + ny) / nm;
    this.mass = nm;
    this.insertChild(idx, nx, ny);
  }

  private insertChild(idx: number, nx: number, ny: number): void {
    const hw = this.w / 2, hh = this.h / 2;
    const q = (ny >= this.y + hh ? 2 : 0) + (nx >= this.x + hw ? 1 : 0);
    this.children![q].insert(idx, nx, ny);
  }

  // Accumulate repulsion force on node i at position (nx, ny)
  calcForce(i: number, nx: number, ny: number, fx: Float32Array, fy: Float32Array): void {
    if (this.mass === 0) return;
    const dx = nx - this.cx, dy = ny - this.cy;
    const d2 = dx * dx + dy * dy;
    if (d2 < 0.01) return;

    if (this.children === null) {
      // Leaf: skip self
      if (this.body === i) return;
      const d = Math.sqrt(d2);
      const f = Math.min(REPULSION / d2, MAX_FORCE);
      fx[i] += f * dx / d; fy[i] += f * dy / d;
      return;
    }

    const s = this.w > this.h ? this.w : this.h;
    if (s * s < THETA * THETA * d2) {
      // Far enough: treat subtree as single body
      const d = Math.sqrt(d2);
      const f = Math.min(REPULSION * this.mass / d2, MAX_FORCE);
      fx[i] += f * dx / d; fy[i] += f * dy / d;
      return;
    }

    for (const c of this.children) c.calcForce(i, nx, ny, fx, fy);
  }
}

// ─── Component ───────────────────────────────────────────────────────────────
export default function ConceptGraphExplorer({ concepts, maxNodes = DEFAULT_MAX_NODES }: { concepts: Concept[]; maxNodes?: number | null }) {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef    = useRef<HTMLCanvasElement>(null);
  const nodesRef     = useRef<Node[]>([]);
  const edgesRef     = useRef<Edge[]>([]);
  const viewRef      = useRef<View>({ tx: 0, ty: 0, scale: 1 });
  const hoveredRef   = useRef(-1);
  const draggingRef  = useRef(-1);
  const panRef       = useRef<{ startMX: number; startMY: number; startTX: number; startTY: number } | null>(null);
  const downPosRef   = useRef<{ x: number; y: number } | null>(null);
  const rafRef       = useRef(0);
  const settledRef   = useRef(false);

  useEffect(() => {
    const container = containerRef.current;
    const canvas    = canvasRef.current;
    if (!container || !canvas || concepts.length === 0) return;

    cancelAnimationFrame(rafRef.current);

    const dpr = window.devicePixelRatio || 1;
    const W   = container.clientWidth  || 800;
    const H   = container.clientHeight || 600;

    canvas.width  = W * dpr;
    canvas.height = H * dpr;
    const ctx = canvas.getContext("2d")!;
    ctx.scale(dpr, dpr);

    // Most-connected concepts first, optionally capped
    const all = [...concepts].sort((a, b) => b.relatedTitles.length - a.relatedTitles.length);
    const sorted = maxNodes !== null ? all.slice(0, maxNodes) : all;

    const N   = sorted.length;
    const idx = new Map<string, number>();
    sorted.forEach((c, i) => idx.set(c.title.toLowerCase(), i));

    // Grid placement with jitter — nodes start spread, not clustered
    const cols  = Math.ceil(Math.sqrt(N * (W / H)));
    const cellW = W / (cols + 1);
    const cellH = H / (Math.ceil(N / cols) + 1);

    const nodes: Node[] = sorted.map((c, i) => ({
      title: c.title, slug: c.slug,
      x: cellW * ((i % cols) + 1) + (Math.random() - 0.5) * cellW * 0.4,
      y: cellH * (Math.floor(i / cols) + 1) + (Math.random() - 0.5) * cellH * 0.4,
      vx: 0, vy: 0,
    }));

    const seen  = new Set<string>();
    const edges: Edge[] = [];
    sorted.forEach((c, si) => {
      for (const t of c.relatedTitles) {
        const ti = idx.get(t.toLowerCase());
        if (ti === undefined || ti === si) continue;
        const key = `${Math.min(si, ti)}-${Math.max(si, ti)}`;
        if (!seen.has(key)) { seen.add(key); edges.push({ s: si, t: ti }); }
      }
    });

    nodesRef.current  = nodes;
    edgesRef.current  = edges;
    viewRef.current   = { tx: 0, ty: 0, scale: 1 };
    settledRef.current = false;

    const fx = new Float32Array(N);
    const fy = new Float32Array(N);

    // Compute bounding box for the quadtree root
    function buildTree(): QTree {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const n of nodes) {
        if (n.x < minX) minX = n.x; if (n.x > maxX) maxX = n.x;
        if (n.y < minY) minY = n.y; if (n.y > maxY) maxY = n.y;
      }
      const pad = 1;
      const size = Math.max(maxX - minX, maxY - minY) + pad * 2;
      const tree = new QTree(minX - pad, minY - pad, size, size);
      for (let i = 0; i < N; i++) tree.insert(i, nodes[i].x, nodes[i].y);
      return tree;
    }

    function simTick(): number {
      fx.fill(0); fy.fill(0);
      const drag = draggingRef.current;

      // Barnes-Hut repulsion — O(N log N)
      const tree = buildTree();
      for (let i = 0; i < N; i++) {
        if (i !== drag) tree.calcForce(i, nodes[i].x, nodes[i].y, fx, fy);
      }

      // Spring forces — O(E)
      for (const e of edges) {
        const dx = nodes[e.t].x - nodes[e.s].x;
        const dy = nodes[e.t].y - nodes[e.s].y;
        const d  = Math.max(Math.sqrt(dx * dx + dy * dy), 0.01);
        const f  = (d - SPRING_LEN) * SPRING_K;
        const ux = dx / d, uy = dy / d;
        fx[e.s] += f * ux; fy[e.s] += f * uy;
        fx[e.t] -= f * ux; fy[e.t] -= f * uy;
      }

      let ke = 0;
      for (let i = 0; i < N; i++) {
        if (i === drag) continue;
        fx[i] += (W / 2 - nodes[i].x) * CENTER_PULL;
        fy[i] += (H / 2 - nodes[i].y) * CENTER_PULL;
        nodes[i].vx = (nodes[i].vx + fx[i]) * DAMPING;
        nodes[i].vy = (nodes[i].vy + fy[i]) * DAMPING;
        const spd = Math.sqrt(nodes[i].vx ** 2 + nodes[i].vy ** 2);
        if (spd > VEL_CAP) { nodes[i].vx *= VEL_CAP / spd; nodes[i].vy *= VEL_CAP / spd; }
        nodes[i].x += nodes[i].vx;
        nodes[i].y += nodes[i].vy;
        ke += nodes[i].vx ** 2 + nodes[i].vy ** 2;
      }
      return ke;
    }

    function draw() {
      const hovered = hoveredRef.current;
      const { tx, ty, scale } = viewRef.current;

      ctx.clearRect(0, 0, W, H);
      ctx.save();
      ctx.translate(tx, ty);
      ctx.scale(scale, scale);

      const neighbors = new Set<number>();
      if (hovered >= 0) {
        for (const e of edges) {
          if (e.s === hovered) neighbors.add(e.t);
          if (e.t === hovered) neighbors.add(e.s);
        }
      }

      ctx.strokeStyle = "rgba(0,0,0,0.06)";
      ctx.lineWidth   = 0.8 / scale;
      ctx.beginPath();
      for (const e of edges) {
        ctx.moveTo(nodes[e.s].x, nodes[e.s].y);
        ctx.lineTo(nodes[e.t].x, nodes[e.t].y);
      }
      ctx.stroke();

      if (hovered >= 0) {
        ctx.strokeStyle = "rgba(0,0,0,0.22)";
        ctx.lineWidth   = 1.2 / scale;
        for (const e of edges) {
          if (e.s !== hovered && e.t !== hovered) continue;
          ctx.beginPath();
          ctx.moveTo(nodes[e.s].x, nodes[e.s].y);
          ctx.lineTo(nodes[e.t].x, nodes[e.t].y);
          ctx.stroke();
        }
      }

      const r  = 3.5 / scale;
      const rN = 4.5 / scale;
      const rH = 6   / scale;

      ctx.fillStyle = "#d4d4d8";
      ctx.beginPath();
      for (let i = 0; i < N; i++) {
        if (i === hovered || neighbors.has(i)) continue;
        ctx.moveTo(nodes[i].x + r, nodes[i].y);
        ctx.arc(nodes[i].x, nodes[i].y, r, 0, Math.PI * 2);
      }
      ctx.fill();

      if (neighbors.size > 0) {
        ctx.fillStyle = "#71717a";
        ctx.beginPath();
        neighbors.forEach((ni) => {
          ctx.moveTo(nodes[ni].x + rN, nodes[ni].y);
          ctx.arc(nodes[ni].x, nodes[ni].y, rN, 0, Math.PI * 2);
        });
        ctx.fill();
      }

      if (hovered >= 0 && nodes[hovered]) {
        const { x, y, title } = nodes[hovered];
        ctx.fillStyle = "#18181b";
        ctx.beginPath();
        ctx.arc(x, y, rH, 0, Math.PI * 2);
        ctx.fill();

        const fs  = 11 / scale;
        ctx.font  = `500 ${fs}px system-ui, -apple-system, sans-serif`;
        const tw  = ctx.measureText(title).width;
        const px  = 7 / scale, py = 4 / scale;
        const bh  = fs + py * 2;
        let bx    = x + 10 / scale;
        let by    = y - bh - 8 / scale;
        if (bx + tw + px * 2 > (W - tx) / scale) bx = x - tw - px * 2 - 10 / scale;
        if (by < (0 - ty) / scale)                 by = y + 8 / scale;

        ctx.fillStyle = "#18181b";
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(bx - px, by, tw + px * 2, bh, 4 / scale);
        else ctx.rect(bx - px, by, tw + px * 2, bh);
        ctx.fill();
        ctx.fillStyle = "#ffffff";
        ctx.fillText(title, bx, by + fs + py * 0.4);
      }

      ctx.restore();
    }

    function frame() {
      if (!settledRef.current) {
        const ke = simTick();
        if (ke < SETTLE_KE && draggingRef.current < 0) settledRef.current = true;
      } else if (draggingRef.current >= 0) {
        simTick();
      }
      draw();
      rafRef.current = requestAnimationFrame(frame);
    }

    rafRef.current = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(rafRef.current);
  }, [concepts]);

  // Wheel zoom
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    function onWheel(e: WheelEvent) {
      e.preventDefault();
      const rect   = canvas!.getBoundingClientRect();
      const cx     = e.clientX - rect.left;
      const cy     = e.clientY - rect.top;
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      const { tx, ty, scale } = viewRef.current;
      const ns = Math.max(0.05, Math.min(20, scale * factor));
      viewRef.current = { scale: ns, tx: cx - (cx - tx) * (ns / scale), ty: cy - (cy - ty) * (ns / scale) };
    }
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, []);

  function hit(cx: number, cy: number) {
    const { tx, ty, scale } = viewRef.current;
    const wx = (cx - tx) / scale, wy = (cy - ty) / scale;
    const nodes = nodesRef.current;
    const hr = 10 / scale;
    let best = -1, bestD = hr * hr;
    for (let i = 0; i < nodes.length; i++) {
      const dx = nodes[i].x - wx, dy = nodes[i].y - wy;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD) { bestD = d2; best = i; }
    }
    return best;
  }

  function xy(e: React.MouseEvent<HTMLCanvasElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    return { cx: e.clientX - r.left, cy: e.clientY - r.top };
  }

  function onMouseDown(e: React.MouseEvent<HTMLCanvasElement>) {
    const { cx, cy } = xy(e);
    downPosRef.current = { x: cx, y: cy };
    const h = hit(cx, cy);
    if (h >= 0) {
      draggingRef.current = h;
      settledRef.current  = false;
      e.currentTarget.style.cursor = "grabbing";
    } else {
      panRef.current = { startMX: cx, startMY: cy, startTX: viewRef.current.tx, startTY: viewRef.current.ty };
      e.currentTarget.style.cursor = "grabbing";
    }
  }

  function onMouseMove(e: React.MouseEvent<HTMLCanvasElement>) {
    const { cx, cy } = xy(e);
    if (draggingRef.current >= 0) {
      const { tx, ty, scale } = viewRef.current;
      const n = nodesRef.current[draggingRef.current];
      if (n) { n.x = (cx - tx) / scale; n.y = (cy - ty) / scale; n.vx = 0; n.vy = 0; }
      return;
    }
    if (panRef.current) {
      viewRef.current.tx = panRef.current.startTX + (cx - panRef.current.startMX);
      viewRef.current.ty = panRef.current.startTY + (cy - panRef.current.startMY);
      e.currentTarget.style.cursor = "grabbing";
      return;
    }
    const h = hit(cx, cy);
    hoveredRef.current = h;
    e.currentTarget.style.cursor = h >= 0 ? "pointer" : "default";
  }

  function onMouseUp(e: React.MouseEvent<HTMLCanvasElement>) {
    const { cx, cy } = xy(e);
    const down = downPosRef.current;
    const moved = down && (Math.abs(cx - down.x) > 4 || Math.abs(cy - down.y) > 4);
    const wasDragging = draggingRef.current >= 0;
    if (!moved && !wasDragging) {
      const h = hit(cx, cy);
      if (h >= 0) router.push(`/concept/${nodesRef.current[h].slug}`);
    }
    if (wasDragging) settledRef.current = false;
    draggingRef.current = -1;
    panRef.current      = null;
    downPosRef.current  = null;
    e.currentTarget.style.cursor = hit(cx, cy) >= 0 ? "pointer" : "default";
  }

  function onMouseLeave() {
    hoveredRef.current  = -1;
    draggingRef.current = -1;
    panRef.current      = null;
  }

  const total = concepts.length;
  const shown = maxNodes !== null ? Math.min(total, maxNodes) : total;

  return (
    <div ref={containerRef} className="w-full h-full relative">
      <canvas
        ref={canvasRef}
        className="block w-full h-full"
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseLeave}
      />
      {maxNodes !== null && total > maxNodes && (
        <div className="absolute bottom-3 right-3 text-[10px] text-zinc-400 bg-white/80 px-2 py-1 rounded-md border border-zinc-100">
          Top {shown} of {total} concepts
        </div>
      )}
    </div>
  );
}
