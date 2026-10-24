"use client";

import { usePathname } from "next/navigation";
import { AsciiArt } from "@/components/ascii/AsciiArt";

// A slowly turning ascii globe (ascii.rest "earth") behind the pages. Purely
// decorative: fixed, behind the content, not clickable, hidden from screen
// readers. The library holds it still for reduced-motion users and pauses it
// when the tab is hidden. The grid is 60 x 30 characters (about 36em x 30em),
// so the font size is set to fit the window.
//
// Not drawn on a phone's observer page (/observe/<id>): that page is a
// full-screen camera view that covers it, and the phone is busy streaming.
export function EarthBackground() {
  const pathname = usePathname();
  if (/^\/observe\/[^/]+/.test(pathname)) return null;
  return (
    <div aria-hidden className="earth-bg">
      <AsciiArt piece="earth" size={12} opacity={1} fps={10} style={{ fontSize: "min(2.5vw, 3vh)" }} />
    </div>
  );
}
