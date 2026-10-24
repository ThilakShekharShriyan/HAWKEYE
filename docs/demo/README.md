# HAWKEYE demo

Demo video: https://youtu.be/NG2yeaObvtk (1:47)

## Step-by-step scenario

Two roommates, Thilak (phone `01`) and Arnav (phone `02`), one table with two water bottles.

1. **Prepare** (before going on stage):
   ```bash
   npm run demo:reset -- --yes   # rehearsal places, events and assistant memory go; the house stays
   npm run seed:demo             # Thilak, Arnav, kitchen / laundry / household, sites and supplies
   ```
   Open the dashboard on the laptop in **one** tab, then `/observe/01` on Thilak's phone and
   `/observe/02` on Arnav's. Keep FalkorDB Browser (`http://localhost:3010`, graph `worldstate`)
   and `/house` open.
2. **Register.** Thilak points his phone at the table: *"Hey Hawkeye, remember this table."*
   A `Place` node appears with `HOLDS {count}` links to each item (water bottle ×2, …) and
   `Thilak -CARRIES-> his phone -WATCHES-> table`.
3. **Take.** Thilak closes his phone. Arnav takes one bottle with his phone open. The count drops
   to 1, a `Taken` event is written (seen by Arnav's camera), and the table now links to both phones.
4. **Ask.** *"Hey Hawkeye, what happened at the table?"* The TrueForge agent answers from the graph:
   who took what, when, and what is left.

FalkorDB Browser queries for the stage are in the main README under **Stage demo**.

## Video timeline

| Time | Scene |
| --- | --- |
| 0:00 | Title |
| 0:08 | The problem: every phone sees the room, then forgets it |
| 0:19 | The house as a graph (FalkorDB Browser, then `/house`) |
| 0:31 | Thilak's clip: "Hey Hawkeye, remember this table" |
| 0:40 | The new table and its items in FalkorDB; the Places snapshot and timeline |
| 0:54 | Arnav's clip: takes a water bottle |
| 1:07 | Water bottle 2 → 1 in `/house`; the events in FalkorDB |
| 1:18 | Question and spoken answer |
| 1:33 | How it is built |

Everything shown is real output: frames from the two phone clips went through the perception
pipeline, and the screenshots and the answer came from the running app.

## Rebuilding the video

`scripts/demo-video/` holds the tools. Everything they read and write lives under `$HK_VIDEO_DIR`
(default `/tmp/hk-video`); `cards/` and `seg/` are created for you.

**Needs:** Python 3, ffmpeg and ffprobe, Node 20+, and Chrome or Chromium (found automatically,
or set `CHROME_PATH` to its executable).

**Inputs you supply**

| Where | What |
| --- | --- |
| `$HK_VIDEO_DIR/clips/register.mov` | the phone clip of Thilak registering the table (or `--register FILE` / `HK_CLIP_REGISTER`) |
| `$HK_VIDEO_DIR/clips/take.mov` | the phone clip of Arnav taking a bottle (or `--take FILE` / `HK_CLIP_TAKE`) |
| `$HK_VIDEO_DIR/shots/` | screenshots of the running app: `01-house-before`, `02-falkor-household`, `03-falkor-table-registered`, `04-house-table`, `05-places-table`, `06-house-after-take`, `07-falkor-events` (`.png`) |
| `$HK_VIDEO_DIR/vo/` | one voiceover per scene: `s1`…`s9` `.mp3`, plus `q.mp3` (the question) and `a.mp3` (the answer); the script is in `narration.json` |
| `$HK_VIDEO_DIR/answer.json` | `{"question", "answer", "via", "latencyMs"}` from `/api/ask`, for the Q&A slide |

**Tools**

- `shot.mjs <url> <out.png> [waitMs] [cookies.json] [width] [height] [clickText]` screenshots a page in
  headless Chrome over CDP (sets cookies, clicks RUN in FalkorDB Browser, waits for the 3D layout).
- `cards.py static|post` renders title cards, captioned screenshots and clip side panels from HTML.
- `build.py first` builds the scenes up to the Q&A, `build.py second` builds the rest and concatenates
  them into `$HK_VIDEO_DIR/HAWKEYE-demo.mp4`. Slides push in slowly; phone clips sit over a blurred copy
  of themselves; a voiceover that spans two slides continues across both.
