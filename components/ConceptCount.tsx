"use client";

import { useEffect, useState } from "react";

const CONCEPTS_CHANGED_EVENT = "blanket:concepts-changed";

async function fetchConceptCount(): Promise<number> {
  const response = await fetch("/api/concepts", { cache: "no-store" });
  if (!response.ok) return 0;
  const concepts = await response.json();
  return Array.isArray(concepts) ? concepts.length : 0;
}

export default function ConceptCount() {
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    let active = true;

    const refreshCount = async () => {
      const nextCount = await fetchConceptCount();
      if (active) setCount(nextCount);
    };

    refreshCount();

    const handleChange = () => {
      refreshCount();
    };

    window.addEventListener(CONCEPTS_CHANGED_EVENT, handleChange);
    return () => {
      active = false;
      window.removeEventListener(CONCEPTS_CHANGED_EVENT, handleChange);
    };
  }, []);

  if (count === null || count === 0) return null;

  return <span className="text-sm tabular-nums text-zinc-400">{count} concept{count !== 1 ? "s" : ""}</span>;
}

export function notifyConceptsChanged() {
  window.dispatchEvent(new Event(CONCEPTS_CHANGED_EVENT));
}