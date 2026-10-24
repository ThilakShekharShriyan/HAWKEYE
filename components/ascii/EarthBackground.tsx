import { AsciiArt } from "@/components/ascii/AsciiArt";

// A slowly turning ascii globe (ascii.rest "earth") behind every page. Purely
// decorative: fixed, behind the content, not clickable, hidden from screen
// readers. The library holds it still for reduced-motion users and pauses it
// when the tab is hidden. The grid is 60 x 30 characters (about 36em x 30em),
// so the font size is set to fit the window.
export function EarthBackground() {
  return (
    <div aria-hidden className="earth-bg">
      <AsciiArt piece="earth" size={12} opacity={1} fps={10} style={{ fontSize: "min(2.5vw, 3vh)" }} />
    </div>
  );
}
