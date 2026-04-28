"use client";

import { useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import type { Concept } from "@/lib/store";

type Node = { x: number; y: number; vx: number; vy: number; title: string; slug: string };
type Edge = { s: number; t: number };
type View = { tx: number; ty: number; scale: number };

export default function ConceptGraphExplorer({ concepts }: { concepts: Concept[] }) {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const nodesRef = useRef<Node[]>([]);
  const edgesRef = useRef<Edge[]>([]);
  const viewRef = useRef<View>({ tx: 0, ty: 0, scale: 1 });
  const hoveredRef = useRef<number>(-1);
  const draggingNodeRef = useRef<number>(-1);
  const panRef = useRef<{ startMX: number; startMY: number; startTX: number; startTY: number } | null>(null);
  const mouseDownPosRef = useRef<{ x: number; y: number } | null>(null);
  const rafRef = useRef<number>(0);
  const settledRef = useRef(false);

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas || concepts.length === 0) return;

    const dpr = window.devicePixelRatio || 1;
    const W = container.clientWidth || 800;
    const H = container.clientHeight || 600;

    canvas.width = W * dpr;
    canvas.height = H * dpr;
    const ctx = canvas.getContext("2d")!;
    ctx.scale(dpr, dpr);

    const idx = new Map<string, number>();
    concepts.forEach((c, i) => idx.set(c.title.toLowerCase(), i));

    const spread = Math.min(W, H) * 0.4;
    const nodes: Node[] = concepts.map((c) => ({
      title: c.title,
      slug: c.slug,
      x: W / 2 + (Math.random() - 0.5) * spread * 2,
      y: H / 2 + (Math.random() - 0.5) * spread,
      vx: 0,
      vy: 0,
    }));

    const seen = new Set<string>();
    const edges: Edge[] = [];
    concepts.forEach((c, si) => {
      for (const t of c.relatedTitles) {
        const ti = idx.get(t.toLowerCase());
        if (ti === undefined || ti === si) continue;
        const key = `${Math.min(si, ti)}-${Math.max(si, ti)}`;
        if (!seen.has(key)) { seen.add(key); edges.push({ s: si, t: ti }); }
      }
    });

    nodesRef.current = nodes;
    edgesRef.current = edges;
    viewRef.current = { tx: 0, ty: 0, scale: 1 };
    settledRef.current = false;

    function simTick() {
      const N = nodes.length;
      const dragging = draggingNodeRef.current;
      const fx = new Float32Array(N);
      const fy = new Float32Array(N);

      for (let i = 0; i < N; i++) {
        for (let j = i + 1; j < N; j++) {
          const dx = nodes[j].x - nodes[i].x;
          const dy = nodes[j].y - nodes[i].y;
          const d2 = Math.max(dx * dx + dy * dy, 4);
          const d = Math.sqrt(d2);
          const f = 280 / d2;
          const ux = dx / d, uy = dy / d;
          fx[i] -= f * ux; fy[i] -= f * uy;
          fx[j] += f * ux; fy[j] += f * uy;
        }
      }

      for (const e of edges) {
        const dx = nodes[e.t].x - nodes[e.s].x;
        const dy = nodes[e.t].y - nodes[e.s].y;
        const d = Math.max(Math.sqrt(dx * dx + dy * dy), 0.01);
        const f = (d - 40) * 0.018;
        const ux = dx / d, uy = dy / d;
        fx[e.s] += f * ux; fy[e.s] += f * uy;
        fx[e.t] -= f * ux; fy[e.t] -= f * uy;
      }

      let ke = 0;
      for (let i = 0; i < N; i++) {
        if (i === dragging) continue;
        fx[i] += (W / 2 - nodes[i].x) * 0.005;
        fy[i] += (H / 2 - nodes[i].y) * 0.005;
        nodes[i].vx = (nodes[i].vx + fx[i]) * 0.80;
        nodes[i].vy = (nodes[i].vy + fy[i]) * 0.80;
        nodes[i].x += nodes[i].vx;
        nodes[i].y += nodes[i].vy;
        ke += nodes[i].vx * nodes[i].vx + nodes[i].vy * nodes[i].vy;
      }
      if (ke < 0.05 && dragging < 0) settledRef.current = true;
    }

    function draw() {
      const N = nodes.length;
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

      ctx.strokeStyle = "rgba(0,0,0,0.07)";
      ctx.lineWidth = 0.8 / scale;
      ctx.beginPath();
      for (const e of edges) {
        ctx.moveTo(nodes[e.s].x, nodes[e.s].y);
        ctx.lineTo(nodes[e.t].x, nodes[e.t].y);
      }
      ctx.stroke();

      if (hovered >= 0) {
        ctx.strokeStyle = "rgba(0,0,0,0.22)";
        ctx.lineWidth = 1.2 / scale;
        for (const e of edges) {
          if (e.s === hovered || e.t === hovered) {
            ctx.beginPath();
            ctx.moveTo(nodes[e.s].x, nodes[e.s].y);
            ctx.lineTo(nodes[e.t].x, nodes[e.t].y);
            ctx.stroke();
          }
        }
      }

      const r = 3.5 / scale;
      const rN = 4.5 / scale;
      const rH = 6 / scale;

      ctx.fillStyle = "#d4d4d8";
      ctx.beginPath();
      for (let i = 0; i < N; i++) {
        if (i !== hovered && !neighbors.has(i)) {
          ctx.moveTo(nodes[i].x + r, nodes[i].y);
          ctx.arc(nodes[i].x, nodes[i].y, r, 0, Math.PI * 2);
        }
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
        ctx.fillStyle = "#18181b";
        ctx.beginPath();
        ctx.arc(nodes[hovered].x, nodes[hovered].y, rH, 0, Math.PI * 2);
        ctx.fill();

        const { x, y, title } = nodes[hovered];
        const fs = 11 / scale;
        ctx.font = `500 ${fs}px system-ui, -apple-system, sans-serif`;
        const tw = ctx.measureText(title).width;
        const px = 7 / scale, py = 4 / scale;
        const boxH = fs + py * 2;
        let bx = x + 10 / scale;
        let by = y - boxH - 8 / scale;

        const maxWX = (W - tx) / scale - tw - px * 2 - 4 / scale;
        const minWY = (0 - ty) / scale + 4 / scale;
        if (bx > maxWX) bx = x - tw - px * 2 - 10 / scale;
        if (by < minWY) by = y + 8 / scale;

        ctx.fillStyle = "#18181b";
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(bx - px, by, tw + px * 2, boxH, 4 / scale);
        else ctx.rect(bx - px, by, tw + px * 2, boxH);
        ctx.fill();

        ctx.fillStyle = "#ffffff";
        ctx.fillText(title, bx, by + fs + py * 0.4);
      }

      ctx.restore();
    }

    function frame() {
      if (!settledRef.current || draggingNodeRef.current >= 0) simTick();
      draw();
      rafRef.current = requestAnimationFrame(frame);
    }

    rafRef.current = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(rafRef.current);
  }, [concepts]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    function onWheel(e: WheelEvent) {
      e.preventDefault();
      const rect = canvas!.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      const { tx, ty, scale } = viewRef.current;
      const ns = Math.max(0.1, Math.min(12, scale * factor));
      viewRef.current = { scale: ns, tx: cx - (cx - tx) * (ns / scale), ty: cy - (cy - ty) * (ns / scale) };
    }
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, []);

  function hitTest(cx: number, cy: number): number {
    const { tx, ty, scale } = viewRef.current;
    const wx = (cx - tx) / scale;
    const wy = (cy - ty) / scale;
    const nodes = nodesRef.current;
    const hitR = 8 / scale;
    let best = -1, bestD = hitR * hitR;
    for (let i = 0; i < nodes.length; i++) {
      const dx = nodes[i].x - wx, dy = nodes[i].y - wy;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD) { bestD = d2; best = i; }
    }
    return best;
  }

  function canvasXY(e: React.MouseEvent<HTMLCanvasElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    return { cx: e.clientX - r.left, cy: e.clientY - r.top };
  }

  function onMouseDown(e: React.MouseEvent<HTMLCanvasElement>) {
    const { cx, cy } = canvasXY(e);
    mouseDownPosRef.current = { x: cx, y: cy };
    const h = hitTest(cx, cy);
    if (h >= 0) {
      draggingNodeRef.current = h;
      settledRef.current = false;
      e.currentTarget.style.cursor = "grabbing";
    } else {
      panRef.current = { startMX: cx, startMY: cy, startTX: viewRef.current.tx, startTY: viewRef.current.ty };
      e.currentTarget.style.cursor = "grabbing";
    }
  }

  function onMouseMove(e: React.MouseEvent<HTMLCanvasElement>) {
    const { cx, cy } = canvasXY(e);

    if (draggingNodeRef.current >= 0) {
      const { tx, ty, scale } = viewRef.current;
      const node = nodesRef.current[draggingNodeRef.current];
      if (node) { node.x = (cx - tx) / scale; node.y = (cy - ty) / scale; node.vx = 0; node.vy = 0; }
      return;
    }

    if (panRef.current) {
      viewRef.current.tx = panRef.current.startTX + (cx - panRef.current.startMX);
      viewRef.current.ty = panRef.current.startTY + (cy - panRef.current.startMY);
      e.currentTarget.style.cursor = "grabbing";
      return;
    }

    const h = hitTest(cx, cy);
    hoveredRef.current = h;
    e.currentTarget.style.cursor = h >= 0 ? "pointer" : "default";
  }

  function onMouseUp(e: React.MouseEvent<HTMLCanvasElement>) {
    const { cx, cy } = canvasXY(e);
    const down = mouseDownPosRef.current;
    const moved = down && (Math.abs(cx - down.x) > 4 || Math.abs(cy - down.y) > 4);
    const wasDraggingNode = draggingNodeRef.current >= 0;

    if (!moved && !wasDraggingNode) {
      const h = hitTest(cx, cy);
      if (h >= 0) router.push(`/concept/${nodesRef.current[h].slug}`);
    }

    if (wasDraggingNode) settledRef.current = false;

    draggingNodeRef.current = -1;
    panRef.current = null;
    mouseDownPosRef.current = null;
    const h = hitTest(cx, cy);
    e.currentTarget.style.cursor = h >= 0 ? "pointer" : "default";
  }

  function onMouseLeave() {
    hoveredRef.current = -1;
    draggingNodeRef.current = -1;
    panRef.current = null;
  }

  if (concepts.length === 0) return null;

  return (
    <div ref={containerRef} className="w-full h-full">
      <canvas
        ref={canvasRef}
        className="block w-full h-full"
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseLeave}
      />
    </div>
  );
}
