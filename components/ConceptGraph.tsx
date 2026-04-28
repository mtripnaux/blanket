"use client";

import { useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import type { Concept } from "@/lib/store";

type SNode = { x: number; y: number; vx: number; vy: number; title: string; slug: string };
type SEdge = { s: number; t: number };

const LW = 680;
const LH = 220;
const MAX_TICKS = 120;
// Elliptical cluster bounds — wide to match the 3:1 canvas aspect ratio
const CLUSTER_RX = 155;
const CLUSTER_RY = 80;

function buildGraph(concepts: Concept[]): { nodes: SNode[]; edges: SEdge[] } {
  const idx = new Map<string, number>();
  concepts.forEach((c, i) => idx.set(c.title.toLowerCase(), i));

  const nodes: SNode[] = concepts.map((c) => {
    // Uniform random placement in an ellipse — matches cluster shape, avoids ring explosion
    const angle = Math.random() * 2 * Math.PI;
    const r = Math.sqrt(Math.random()) * 0.8;
    return {
      title: c.title,
      slug: c.slug,
      x: LW / 2 + r * CLUSTER_RX * Math.cos(angle),
      y: LH / 2 + r * CLUSTER_RY * Math.sin(angle),
      vx: 0,
      vy: 0,
    };
  });

  const seen = new Set<string>();
  const edges: SEdge[] = [];
  concepts.forEach((c, si) => {
    for (const t of c.relatedTitles) {
      const ti = idx.get(t.toLowerCase());
      if (ti === undefined || ti === si) continue;
      const key = Math.min(si, ti) + "-" + Math.max(si, ti);
      if (!seen.has(key)) { seen.add(key); edges.push({ s: si, t: ti }); }
    }
  });

  return { nodes, edges };
}

export default function ConceptGraph({ concepts }: { concepts: Concept[] }) {
  const router = useRouter();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hoveredRef = useRef<number>(-1);
  const nodesRef = useRef<SNode[]>([]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || concepts.length === 0) return;

    const ctx = canvas.getContext("2d")!;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = LW * dpr;
    canvas.height = LH * dpr;
    ctx.scale(dpr, dpr);

    const { nodes, edges } = buildGraph(concepts);
    nodesRef.current = nodes;
    hoveredRef.current = -1;

    let tick = 0;
    let raf: number;

    function frame() {
      const N = nodes.length;
      const hovered = hoveredRef.current;

      if (tick < MAX_TICKS) {
        const fx = new Float32Array(N);
        const fy = new Float32Array(N);

        // Pairwise repulsion — very low strength for dense graphs
        for (let i = 0; i < N; i++) {
          for (let j = i + 1; j < N; j++) {
            const dx = nodes[j].x - nodes[i].x;
            const dy = nodes[j].y - nodes[i].y;
            const d2 = Math.max(dx * dx + dy * dy, 4);
            const d = Math.sqrt(d2);
            const f = 180 / d2;
            const ux = dx / d, uy = dy / d;
            fx[i] -= f * ux; fy[i] -= f * uy;
            fx[j] += f * ux; fy[j] += f * uy;
          }
        }

        // Spring attraction for connected nodes
        for (const e of edges) {
          const dx = nodes[e.t].x - nodes[e.s].x;
          const dy = nodes[e.t].y - nodes[e.s].y;
          const d = Math.max(Math.sqrt(dx * dx + dy * dy), 0.01);
          const f = (d - 14) * 0.025;
          const ux = dx / d, uy = dy / d;
          fx[e.s] += f * ux; fy[e.s] += f * uy;
          fx[e.t] -= f * ux; fy[e.t] -= f * uy;
        }

        for (let i = 0; i < N; i++) {
          fx[i] += (LW / 2 - nodes[i].x) * 0.008;
          fy[i] += (LH / 2 - nodes[i].y) * 0.016;

          const bx = nodes[i].x - LW / 2;
          const by = nodes[i].y - LH / 2;
          const ex = bx / CLUSTER_RX;
          const ey = by / CLUSTER_RY;
          const ed = Math.sqrt(ex * ex + ey * ey) || 0.01;
          if (ed > 1) {
            const excess = ed - 1;
            fx[i] -= (ex / ed) * excess * CLUSTER_RX * 0.5;
            fy[i] -= (ey / ed) * excess * CLUSTER_RY * 0.5;
          }

          nodes[i].vx = (nodes[i].vx + fx[i]) * 0.78;
          nodes[i].vy = (nodes[i].vy + fy[i]) * 0.78;
          nodes[i].x += nodes[i].vx;
          nodes[i].y += nodes[i].vy;
        }
        tick++;
      }

      ctx.clearRect(0, 0, LW, LH);

      // Neighbors of hovered node
      const neighbors = new Set<number>();
      if (hovered >= 0) {
        for (const e of edges) {
          if (e.s === hovered) neighbors.add(e.t);
          if (e.t === hovered) neighbors.add(e.s);
        }
      }

      // All edges — faint enough to see the cluster silhouette
      ctx.strokeStyle = "rgba(0,0,0,0.055)";
      ctx.lineWidth = 0.6;
      ctx.beginPath();
      for (const e of edges) {
        ctx.moveTo(nodes[e.s].x, nodes[e.s].y);
        ctx.lineTo(nodes[e.t].x, nodes[e.t].y);
      }
      ctx.stroke();

      // Highlighted edges for hovered node
      if (hovered >= 0) {
        ctx.strokeStyle = "rgba(0,0,0,0.18)";
        ctx.lineWidth = 0.9;
        for (const e of edges) {
          if (e.s === hovered || e.t === hovered) {
            ctx.beginPath();
            ctx.moveTo(nodes[e.s].x, nodes[e.s].y);
            ctx.lineTo(nodes[e.t].x, nodes[e.t].y);
            ctx.stroke();
          }
        }
      }

      // Base nodes
      ctx.fillStyle = "#d4d4d8";
      ctx.beginPath();
      for (let i = 0; i < N; i++) {
        if (i !== hovered && !neighbors.has(i)) {
          ctx.moveTo(nodes[i].x + 2, nodes[i].y);
          ctx.arc(nodes[i].x, nodes[i].y, 2, 0, Math.PI * 2);
        }
      }
      ctx.fill();

      // Neighbor nodes
      if (neighbors.size > 0) {
        ctx.fillStyle = "#71717a";
        ctx.beginPath();
        neighbors.forEach((ni) => {
          ctx.moveTo(nodes[ni].x + 3, nodes[ni].y);
          ctx.arc(nodes[ni].x, nodes[ni].y, 3, 0, Math.PI * 2);
        });
        ctx.fill();
      }

      // Hovered node + tooltip
      if (hovered >= 0 && nodes[hovered]) {
        ctx.fillStyle = "#18181b";
        ctx.beginPath();
        ctx.arc(nodes[hovered].x, nodes[hovered].y, 4.5, 0, Math.PI * 2);
        ctx.fill();

        const { x, y, title } = nodes[hovered];
        ctx.font = "500 11px system-ui, -apple-system, sans-serif";
        const tw = ctx.measureText(title).width;
        const px = 7, py = 5, th = 14;
        let tx = x + 10, ty = y - 10;
        if (tx + tw + px * 2 > LW - 4) tx = x - tw - px * 2 - 10;
        if (ty - th - py < 4) ty = y + th + py + 8;

        ctx.fillStyle = "#18181b";
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(tx - px, ty - th - py, tw + px * 2, th + py * 2, 4);
        else ctx.rect(tx - px, ty - th - py, tw + px * 2, th + py * 2);
        ctx.fill();

        ctx.fillStyle = "#ffffff";
        ctx.fillText(title, tx, ty - py + 1);
      }

      raf = requestAnimationFrame(frame);
    }

    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [concepts]);

  const onMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = (e.clientX - rect.left) * (LW / rect.width);
    const my = (e.clientY - rect.top) * (LH / rect.height);
    const nodes = nodesRef.current;
    let best = -1, bestD = 14 * 14;
    for (let i = 0; i < nodes.length; i++) {
      const dx = nodes[i].x - mx, dy = nodes[i].y - my;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD) { bestD = d2; best = i; }
    }
    hoveredRef.current = best;
    canvas.style.cursor = best >= 0 ? "pointer" : "default";
  }, []);

  const onMouseLeave = useCallback(() => {
    hoveredRef.current = -1;
    if (canvasRef.current) canvasRef.current.style.cursor = "default";
  }, []);

  const onClick = useCallback(() => {
    const h = hoveredRef.current;
    const nodes = nodesRef.current;
    if (h >= 0 && nodes[h]) router.push(`/concept/${nodes[h].slug}`);
  }, [router]);

  if (concepts.length === 0) return null;

  return (
    <canvas
      ref={canvasRef}
      style={{ width: "100%", aspectRatio: `${LW}/${LH}` }}
      className="block rounded-xl border border-zinc-200 bg-white"
      onMouseMove={onMouseMove}
      onMouseLeave={onMouseLeave}
      onClick={onClick}
    />
  );
}
