import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center animate-fade-in">
      <p className="text-5xl font-bold text-black mb-4">404</p>
      <p className="text-sm text-zinc-500 mb-6">This concept doesn't exist in your glossary.</p>
      <Link
        href="/"
        className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 transition-colors"
      >
        Back to glossary
      </Link>
    </div>
  );
}
