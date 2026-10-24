// node shot.mjs <url> <out.png> [waitMs] [cookies.json] [width] [height] [clickText]
// Screenshots a page in headless Chrome over CDP: sets cookies, dismisses "Not now" popups, waits, captures.
import { spawn } from "node:child_process";
import { writeFileSync, readFileSync, existsSync } from "node:fs";

// CHROME_PATH, else the first installed Chrome or Chromium.
const chromePath = [
  process.env.CHROME_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/snap/bin/chromium",
].find((path) => path && existsSync(path));
if (!chromePath) {
  console.error("Chrome not found: install Chrome or Chromium, or set CHROME_PATH to its executable.");
  process.exit(1);
}
const [url, out, waitMs = "6000", cookieFile, width = "1600", height = "900", clickText] = process.argv.slice(2);
const port = 9333 + Math.floor(Math.random() * 500);
const chrome = spawn(chromePath, [
  "--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${process.env.HK_VIDEO_DIR ?? "/tmp/hk-video"}/chrome-${port}`,
  "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--hide-scrollbars",
  `--window-size=${width},${height}`, "about:blank",
], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let target;
for (let i = 0; i < 50 && !target; i++) {
  await sleep(200);
  try { target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === "page"); } catch {}
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));
let id = 0; const pending = new Map();
ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
const send = (method, params = {}) => new Promise((r) => { const n = ++id; pending.set(n, r); ws.send(JSON.stringify({ id: n, method, params })); });
await send("Network.enable"); await send("Page.enable");
if (cookieFile && existsSync(cookieFile)) for (const c of JSON.parse(readFileSync(cookieFile, "utf8"))) await send("Network.setCookie", c);
await send("Page.navigate", { url });
const dismiss = `(() => { for (const b of document.querySelectorAll("button")) if (/^(Not now|Close|Dismiss)$/i.test(b.textContent.trim())) b.click(); })()`;
const hideDev = `(() => { if (!document.getElementById("shot-css")) { const s = document.createElement("style"); s.id = "shot-css"; s.textContent = "nextjs-portal{display:none!important}"; document.head.appendChild(s); } })()`;
const click = clickText ? `(() => { for (const b of document.querySelectorAll("button")) if (b.textContent.trim().toUpperCase() === ${JSON.stringify((clickText || "").toUpperCase())}) { b.click(); return true; } return false; })()` : null;
let clicked = false;
const total = +waitMs;
for (let t = 0; t < total; t += 1000) {
  await sleep(1000);
  await send("Runtime.evaluate", { expression: dismiss });
  await send("Runtime.evaluate", { expression: hideDev });
  if (click && !clicked && t >= 2000) clicked = (await send("Runtime.evaluate", { expression: click, returnByValue: true })).result?.result?.value === true;
}
if (click && !clicked) console.log(`warning: no "${clickText}" button found`);
const shot = await send("Page.captureScreenshot", { format: "png" });
writeFileSync(out, Buffer.from(shot.result.data, "base64"));
ws.close(); chrome.kill();
console.log(`saved ${out}`);
process.exit(0);
