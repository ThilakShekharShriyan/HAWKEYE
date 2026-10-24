# Renders 1920x1080 slides (opaque) and side panels (transparent) as PNGs via headless Chrome.
import json, os, subprocess, sys, html
WORK = os.environ.get("HK_VIDEO_DIR", "/tmp/hk-video")
CH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
BASE="""<html><head><meta charset="utf-8"><style>
*{margin:0;padding:0;box-sizing:border-box}
body{width:1920px;height:1080px;overflow:hidden;font-family:-apple-system,"SF Pro Display","Helvetica Neue",Arial,sans-serif;color:#e8eaed;BG}
.brand{letter-spacing:.32em;font-weight:600;color:#fff}
.accent{color:#8eb6ff}.gold{color:#f0c36a}.green{color:#7dcea0}.pink{color:#f4a6a0}.violet{color:#d7b4ff}
.dim{color:#9aa3ad}
</style></head><body>BODY</body></html>"""
def render(name, body, transparent=False, bg="background:#0b0d10"):
    page=BASE.replace("BG", "background:transparent" if transparent else bg).replace("BODY", body)
    path=f"{WORK}/cards/{name}.html"; open(path,"w").write(page)
    args=[CH,"--headless=new","--hide-scrollbars","--window-size=1920,1080",f"--screenshot={WORK}/cards/{name}.png","--virtual-time-budget=3000"]
    if transparent: args.append("--default-background-color=00000000")
    subprocess.run(args+[f"file://{path}"],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,check=True)
    print("card", name)

def slide_with_shot(name, shot, title, sub, tag):
    body=f"""<div style="position:absolute;inset:0;display:flex;flex-direction:column">
      <div style="flex:1;display:flex;align-items:center;justify-content:center;padding:36px 60px 0">
        <img src="file://{shot}" style="max-width:100%;max-height:100%;border-radius:14px;box-shadow:0 20px 60px rgba(0,0,0,.6);border:1px solid #23272e"></div>
      <div style="height:190px;display:flex;align-items:center;gap:36px;padding:0 70px">
        <div style="font-size:20px" class="brand">HAWKEYE</div>
        <div style="width:2px;height:90px;background:#23272e"></div>
        <div><div style="font-size:44px;font-weight:600">{title}</div><div style="font-size:26px;margin-top:8px" class="dim">{sub}</div></div>
        <div style="margin-left:auto;font-size:22px;padding:10px 18px;border:1px solid #2e3440;border-radius:999px" class="dim">{tag}</div>
      </div></div>"""
    render(name, body)

def side_panel(name, who, quote, note):
    body=f"""<div style="position:absolute;left:1150px;top:0;width:770px;height:1080px;display:flex;flex-direction:column;justify-content:center;padding:0 60px 0 30px">
      <div style="font-size:20px" class="brand">HAWKEYE</div>
      <div style="font-size:34px;margin-top:36px" class="accent">{who}</div>
      <div style="font-size:58px;font-weight:600;line-height:1.15;margin-top:18px">{quote}</div>
      <div style="font-size:28px;line-height:1.45;margin-top:34px" class="dim">{note}</div></div>"""
    render(name, body, transparent=True)

which=sys.argv[1] if len(sys.argv)>1 else "all"
if which in ("all","static"):
    render("s1-title", """<div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;background:radial-gradient(ellipse at 50% 40%,#16202e 0%,#0b0d10 65%)">
      <div style="font-size:150px;letter-spacing:.28em;font-weight:700;color:#fff;margin-left:.28em">HAWKEYE</div>
      <div style="font-size:44px;margin-top:28px" class="dim">The shared memory of a home</div>
      <div style="font-size:26px;margin-top:70px;letter-spacing:.08em" class="dim">Roommate &amp; room tracking on a <span class="pink">FalkorDB</span> graph &nbsp;·&nbsp; Patch the Conference</div></div>""")
    render("s2-problem", """<div style="position:absolute;inset:0;padding:150px 170px">
      <div style="font-size:22px" class="brand">THE PROBLEM</div>
      <div style="font-size:76px;font-weight:600;line-height:1.15;margin-top:40px;max-width:1500px">Every phone sees the room.<br><span class="dim">Then it forgets it.</span></div>
      <div style="display:flex;gap:40px;margin-top:90px;font-size:36px">
        <div style="flex:1;padding:34px;border:1px solid #23272e;border-radius:18px"><div class="gold" style="font-size:56px">?</div>How many are left?</div>
        <div style="flex:1;padding:34px;border:1px solid #23272e;border-radius:18px"><div class="accent" style="font-size:56px">?</div>Who took the last one?</div>
        <div style="flex:1;padding:34px;border:1px solid #23272e;border-radius:18px"><div class="green" style="font-size:56px">?</div>What do we need to buy?</div></div></div>""")
    render("s9-stack", """<div style="position:absolute;inset:0;padding:120px 170px">
      <div style="font-size:22px" class="brand">HOW IT IS BUILT</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:34px;margin-top:60px;font-size:30px;line-height:1.4">
        <div style="padding:38px;border:1px solid #23272e;border-radius:18px"><div class="pink" style="font-size:40px;font-weight:600">FalkorDB</div>The memory: people, rooms, sites, items, events. Answers are graph paths. Queried through the FalkorDB MCP.</div>
        <div style="padding:38px;border:1px solid #23272e;border-radius:18px"><div class="accent" style="font-size:40px;font-weight:600">TrueForge on OpenAI</div>The answer agent, gpt-5.5, reads the graph read-only before it speaks.</div>
        <div style="padding:38px;border:1px solid #23272e;border-radius:18px"><div class="green" style="font-size:40px;font-weight:600">Phones as observers</div>Vision episodes plus a live object tracker that writes counts in about a second. ElevenLabs voice.</div>
        <div style="padding:38px;border:1px solid #23272e;border-radius:18px"><div class="violet" style="font-size:40px;font-weight:600">Qodo</div>Every change shipped as a pull request reviewed by Qodo, with its findings fixed.</div></div>
      <div style="position:absolute;left:0;right:0;bottom:90px;text-align:center;font-size:64px;letter-spacing:.28em;font-weight:700;color:#ff">HAWKEYE</div></div>""")
    side_panel("s4-panel","Thilak's phone · observer 01","“Hey Hawkeye, remember this table.”","The table becomes a shared place in the graph, with everything the camera counted on it.")
    side_panel("s6-panel","Arnav's phone · observer 02","Arnav takes a water bottle","Nobody types anything. The camera sees the hand reach in and the bottle leave.")
    slide_with_shot("s3a",f"{WORK}/shots/02-falkor-household.png","The house is a graph","Thilak and Arnav, their phones, and the responsibilities they share","FalkorDB Browser")
    slide_with_shot("s3b",f"{WORK}/shots/01-house-before.png","Rooms, sites and supplies","Kitchen, laundry and household, with everything each site holds","HAWKEYE · 3D house")
    slide_with_shot("s5a",f"{WORK}/shots/03-falkor-table-registered.png","A new shared entity: the table","table HOLDS water bottle ×2, laptop, napkins…  ·  Thilak → phone 01 → WATCHES → table","FalkorDB Browser")
    slide_with_shot("s5b",f"{WORK}/shots/05-places-table.png","Snapshot, timeline and log","Registered by Thilak's camera, kept with the picture it saw","HAWKEYE · Places")

if which=="post":
    a=json.load(open(f"{WORK}/answer.json"))
    slide_with_shot("s7a",f"{WORK}/shots/06-house-after-take.png","Water bottle: 2 → 1","The count changed in the graph, and the table now links to both roommates’ phones","HAWKEYE · 3D house")
    slide_with_shot("s7b",f"{WORK}/shots/07-falkor-events.png","Every change is an event","Who registered it, whose camera saw the bottle leave, and when","FalkorDB Browser")
    q=html.escape(a["question"]); ans=html.escape(a["answer"])
    render("s8-qa", f"""<div style="position:absolute;inset:0;padding:130px 170px">
      <div style="font-size:22px" class="brand">ASK FROM ANYWHERE</div>
      <div style="margin-top:70px;display:flex;gap:30px;align-items:flex-start">
        <div style="font-size:30px;padding:10px 20px;border-radius:999px;background:#1a2433" class="accent">Thilak</div>
        <div style="font-size:60px;font-weight:600;line-height:1.2">“{q}”</div></div>
      <div style="margin-top:80px;display:flex;gap:30px;align-items:flex-start">
        <div style="font-size:30px;padding:10px 20px;border-radius:999px;background:#2a1f2c" class="pink">HAWKEYE</div>
        <div style="font-size:46px;line-height:1.35">{ans}</div></div>
      <div style="position:absolute;left:170px;bottom:110px;font-size:26px" class="dim">Answered by the TrueForge agent ({html.escape(a.get('via',''))}) from the FalkorDB graph · {a.get('latencyMs','?')} ms</div></div>""")
