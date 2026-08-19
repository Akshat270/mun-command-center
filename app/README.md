# MUN Live Command Center

Local-first operations console for the delegate of **Canada** in **UNGA** at **RPSIS MUN 2026**
(14–15 August 2026).

Agenda: *Discuss the Legality and Ethics of State Surveillance, in the Name of National Security.*

This is a decision-support tool, not an autonomous delegate. It makes your own prepared material
instantly findable, and offers AI as an optional accelerator that always cites its sources. **You
decide what to say.**

---

## Start it

```bash
cd app
npm install      # first time only
npm run go       # build + serve — open http://127.0.0.1:8788
```

For development with hot reload:

```bash
npm run dev      # UI on http://127.0.0.1:5180, API on :8788
```

Use **Chrome or Edge** — browser speech recognition needs one of them.

---

## What works without internet

Everything except live transcription and AI analysis. Those two are the only features that talk to
anything outside this machine — transcription because the browser sends audio to its speech service
(see [Recording](#recording)), AI because the model runs on the provider's servers:

documents · search · speeches · POIs · defence bank · country dossiers · notes · timers ·
procedure reference · bloc board · resolution editor · manual transcript · session export

With no API key configured the app runs normally and shows
*"AI unavailable — local knowledge base remains available."* It never crashes and never blocks.

---

## What ships pre-loaded

Curated from your own prep documents, so the app is useful the moment it starts:

| | |
|---|---|
| **11 speeches** | 30-second opening, 8 topic speeches, the 20-second emergency formula, the 10-second reset |
| **28 POIs** | grouped by Austria / Argentina / Nepal / any delegation, with purpose and follow-up |
| **20 defences** | every likely attack on Canada with a prepared answer |
| **4 dossiers** | Canada (deep), Austria, Argentina, Nepal — facts, vulnerabilities, attack→defense |
| **17 procedure cards** | full committee flow with exact motion wording |
| **11 caucus plays** | "if the room is X → motion for Y" |
| **20 clause ideas** | Canada's priority operative and preambulatory clauses |

Plus your 11 source documents, chunked into ~620 searchable passages.

---

## Keyboard

| Key | |
|---|---|
| `Ctrl K` | Global search — documents, speeches, POIs, countries, notes, clauses, transcript |
| `L` `S` `P` `R` `N` `D` `C` `M` `G` | Live Room · Speeches · POIs · Research · Notes · Draft · Countries · Motions · Dashboard |
| `1` `2` `3` | 30s / 45s / 60s speech (on the Speeches page) |
| `F` | Focus mode — speech in huge text, nothing else |
| `T` | Start / stop timer |
| `A` | Analyze the latest statement (Live Room) |
| `Esc` | Close any overlay |

Single letters are ignored while you are typing, so they never interfere with note-taking.

---

## Before the 14th

1. `npm run go` — confirm it starts.
2. **Research → Import documents** — reads every PDF/DOCX/TXT/MD in the MUN folder. Originals are
   opened read-only and never modified.
3. **Settings → Build semantic index** — do this *while you have internet*. Downloads a ~23 MB model
   once, then works offline. Optional; keyword search is fully offline either way.
4. Test the microphone in the Live Room (Chrome/Edge).
5. **Settings → AI → Add key** if you want AI. Save & test confirms it works.
6. **Pull the network cable and confirm search still works.**
7. Pin your speeches, top POIs and defences so they sit in the right-hand panel.

---

## Everything here is yours to edit

Nothing that ships is fixed. All of it is a starting point:

| | |
|---|---|
| **Speeches** | `+ New speech` to write one · **Details** to change the title, whether it is a GSL or mod-caucus speech, the clock, the text and the memory hook · **Edit** for the text alone · **Delete** |
| **POIs** | `+ New POI` · **Edit** on any card for question, target, topic, strength, purpose, expected response and follow-up · **Delete** from inside the editor · **Mark asked** / **Un-ask** |
| **Defence bank** | `+ New answer` · **Edit** on any entry · **Delete** |
| **Documents** | **Edit** for title, category, country, source priority and notes |
| **Procedure cards** | Edit, and promote to *CONFIRMED FROM RPS MATERIAL* once the Chair says so |

Settings → **Reload curated content** restores the shipped set if you want to start over. It
preserves your notes, transcript, bloc board, resolution and asked-POI marks.

---

## Draft resolutions from Word

**Resolution → Import from Word** takes a `.docx`, `.txt` or `.md` file, or text pasted straight from
the document. It splits the draft into preambulatory and operative clauses so reordering, duplicate
detection and clause review all work on it.

It always shows a **preview first** — every clause it found, and a warning for every line it could
not confidently place — before anything is written. Then you choose: replace the current draft, add
to the end of it, or create a separate one.

Parsing runs entirely on this laptop. No internet, no AI, no upload.

Going the other way: **Download .doc** opens in Word, **.txt** is plain text, **Copy full text**
puts it on the clipboard for a shared document.

> Older `.doc` files are not readable — open in Word and Save As → `.docx`, or paste the text.

---

## AI

Optional. Two ways to add a key:

- **Settings → AI → Add key.** Paste it, press Save & test. It is checked against the provider,
  stored on this laptop, and works immediately — no restart.
- **`.env`.** Copy `.env.example` to `.env`, set `ANTHROPIC_API_KEY`, restart.

Either way the key lives only in the server process and **never reaches the browser** — the page
shows presence, where the key came from, and a masked hint like `sk-ant-…4f2a`, never the value. A
key the provider rejects is not saved. If you are offline when you add one, it is saved unverified
and starts working when you have internet.

| Feature | Model | Roughly |
|---|---|---|
| Respond To This | `claude-sonnet-5` | ~1.4¢ per analysis |
| Defense Mode, Check Clause, session summary, practice | `claude-opus-5` | ~3.4¢ |
| Transcript classification | `claude-haiku-4-5` | ~0.03¢, and most lines are classified locally for free |

Realistically **under $10** for all practice plus both competition days. Providers are swappable
(Anthropic / OpenAI / Google) behind one interface.

### The rules the AI runs under

It is instructed never to invent facts, never to invent Canada's position, to prefer your retrieved
documents over its own knowledge, and to say *"I don't have enough verified material to answer this
confidently"* rather than guess. Every citation is verified against the passages actually supplied —
a citation pointing at a source that was not provided is **stripped and reported** as unverified.

Output is always labelled *"Possible response — you decide what to say."*

---

## What it will never do

No auto-speaking, auto-POI, auto-motion, auto-resolution-edit, auto-vote, and no automatic
recording. Roll call never pre-selects *Present* vs *Present and Voting*. Clause review flags
problems; it does not silently rewrite your text.

---

## Recording

Recording starts only when you press the button, shows an unmissable red `● RECORDING` indicator the
whole time, and can be paused or stopped instantly.

**Read this before you record other people.** Live transcription uses the browser's built-in Web
Speech API, and in Chrome and Edge that is **not** on-device: while you are listening, your
microphone audio is streamed to Google's speech servers to be turned into text. That is how the
feature works, and it is why transcription is the one thing here that needs internet.

So, precisely:

- The **transcript text**, your notes and everything else are stored only on this computer.
- The **audio** goes to Google for as long as you are listening, and is subject to their handling.
- No audio file is ever saved or uploaded by this app.
- Choosing **Manual entry only** in Settings sends nothing anywhere — you type what was said.

Recording and transcription are subject to your conference's rules and to applicable law, which in
many places requires the consent of the people being recorded. Check your conference's rules, get
whatever permission is required, and if there is any doubt use manual transcript entry — it always
works, needs no internet, and involves no third party.

---

## Procedure authority

RPSIS-specific rules were not supplied, so every procedure card is labelled **GENERAL MUN PRACTICE**.
When the Chair announces a rule, edit the card and mark it **CONFIRMED FROM RPS MATERIAL**. Nothing
claims RPS confirmation until you say so. If the Chair gives a different rule, follow the Chair.

---

## Architecture

```
app/
  server/          Fastify · node:sqlite (built in, no native build) · pure-JS parsers
    db/            schema, client, curated seed content
    documents/     parse (pdfjs, mammoth) → clean → chunk → classify → import
    search/        FTS5 + BM25, MUN alias expansion, optional local embeddings, RRF fusion
    ai/            provider abstraction, prompts, compact context builder, citation verification
    resolution/    Word/text → structured clauses (local, deterministic, no AI)
  src/             React + TypeScript + Tailwind, dark command-center UI
  test/            57 end-to-end tests covering the full committee workflow
```

Data lives in `%LOCALAPPDATA%\mun-command-center\` — deliberately outside OneDrive, because a
syncing folder can lock or corrupt a live SQLite database.

Run the tests with the server up:

```bash
npm test
```

---

## Troubleshooting

| | |
|---|---|
| *"Cannot reach the local server"* | The server stopped. Re-run `npm run go`. |
| Speech recognition does nothing | Chrome/Edge only, and it needs internet. Use manual entry. |
| *"Microphone permission denied"* | Allow microphone access in the browser, then start again. |
| A document says *parse failed* | Likely a scanned PDF with no text layer. Open it manually. |
| Search returns nothing | Check documents are imported: Research → Library. |
| AI says unavailable | No key, no internet, or the key was rejected. Settings → AI shows which. Everything else works. |
| Resolution import found no clauses | The draft has no recognisable openers. Check for "Recalling", "Calls upon", "Urges", or numbered operative clauses — or paste the text and add openers by hand. |
| Word file will not import | It is a `.doc`, not a `.docx`. Open in Word, Save As → `.docx`. |
