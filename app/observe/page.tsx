import Link from "next/link";
import { AsciiArt } from "@/components/ascii/AsciiArt";

export default function ObserveIndex() {
  return (
    <main className="flex h-dvh flex-col justify-center gap-3 bg-paper p-6 text-foreground">
      <AsciiArt piece="radar" size={4} opacity={0.55} className="mb-2" />
      <p className="mb-6 text-[13px] tracking-[0.22em] text-ink">HAWKEYE</p>
      {(["01", "02"] as const).map((id) => (
        <Link
          key={id}
          href={`/observe/${id}`}
          className="border border-ink/15 px-5 py-4 text-[12px] tracking-[0.2em] text-ink/85"
        >
          OBSERVER {id}
        </Link>
      ))}
    </main>
  );
}
