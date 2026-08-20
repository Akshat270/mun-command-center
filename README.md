# MUN Live Command Center

A local-first preparation and live-committee assistant for Model UN delegates. Your speeches, points
of information, country research, notes and live transcript live in one place, searchable in the
second or two you actually have between placards going up.

It runs on your own machine. There is no account, no server to sign up to, and nothing to configure
before it works.

**Any country, any committee.** Nothing here is written for a particular delegation or agenda — set
yours in Settings, or in `app/.env`, and every screen and AI prompt follows.

---

## Your data stays yours

This matters enough to state plainly, because it is the reason the app is built this way:

- **Everything is stored on your own computer**, in a SQLite file under your local app data. Not in a
  cloud, not in a shared database, not anywhere the author of this repository can reach.
- **There is no account and no telemetry.** The app never phones home. It has no analytics.
- **Your API key, if you use one, is yours.** It is typed into your own copy, stored on your own
  disk, and used only to talk to the provider you chose. It is never sent to this project, and it
  never reaches the browser — see [SECURITY.md](SECURITY.md).
- **Your prepared material never enters this repository.** Put it in
  `app/server/db/seed-data.local.js`, which is gitignored. The public sample lives in
  `seed-data.example.js`.

Two features do talk to the outside world, and it would be dishonest not to say so up front:

| Feature | What leaves your machine |
|---|---|
| Live transcription | Microphone audio, to your browser's speech service (Google, in Chrome/Edge) |
| AI analysis | The prompt — retrieved passages and transcript excerpts — to the provider you chose |

Both are optional. Everything else — documents, search, speeches, POIs, dossiers, notes, timers,
procedure reference, resolution editor, manual transcript — works fully offline with no key.

---

## Quick start

Requires **Node.js 22.5 or newer** (the app uses Node's built-in SQLite, so there is no native build
step and nothing to compile).

```bash
git clone https://github.com/<your-username>/mun-command-center.git
cd mun-command-center/app
npm install
npm run go          # builds the UI and starts the server
```

Then open **http://127.0.0.1:8788**.

On Windows you can instead double-click **`MUN.cmd`** in the repository root, which will use a
portable Node from `node/` if one is present. See [PORTABLE.md](PORTABLE.md) for running the whole
thing from a pendrive with nothing installed on the host machine.

For development with hot reload:

```bash
npm run dev         # Vite on :5180, API on :8788
```

### Making it yours

1. **Set your committee** — Settings → Committee. Fill in your delegation, committee, agenda and
   conference; everything else follows immediately, with no restart.

   You can also set the `MUN_*` variables in `app/.env` instead (see `.env.example`), which is
   useful for a pendrive build or preparing several committees from one clone. The in-app setting
   wins where both are present.
2. **Add your prepared content** — copy `app/server/db/seed-data.example.js` to `seed-data.local.js`
   in the same folder and edit it. The example file documents every field. Your version is gitignored
   and is picked up automatically.
3. **Add your documents** — point `MUN_SOURCE_DIR` at a folder of `.docx`/`.pdf` files and press
   *Import documents*. They are read-only; originals are never modified.
4. **Optionally add an API key** — Settings → AI. The app is fully usable without one.

---

## ⚠ Do not deploy this to a shared server

**This app is designed to run on one person's machine, and it is not safe to host publicly.** Please
do not put it on Vercel, Netlify, a VPS, or anywhere else other people can reach.

It has **no authentication and no concept of separate users** — not a single table has a user column.
Every visitor to a hosted copy would share one database and one set of API keys. That means:

- everyone would read everyone else's notes, prepared speeches and live committee transcript
- the first person to save an API key would be paying for everyone else's AI usage
- anyone could delete anyone else's work

This is not a bug to be fixed with a login screen — the storage model, the key handling and the
document import all assume a single trusted user at the keyboard. Making it multi-tenant would be a
rewrite, and it is deliberately not on the roadmap. The privacy properties described above are a
*consequence* of running locally.

Binding beyond loopback is guarded for the same reason: setting `HOST` to anything other than
`127.0.0.1` requires also setting `MUN_ALLOW_LAN=1`, and the server prints a warning on every boot
while it is exposed. On conference or school wifi, "reachable from the network" means every other
delegate in the room.

Pull requests that add a hosting configuration will be declined.

---

## Contributing

Contributions are welcome, and you never need an API key or any credential to work on this — the app
runs and the whole test suite passes without one.

Read **[CONTRIBUTING.md](CONTRIBUTING.md)** first. In short: fork, branch, run `npm test` and
`npm run check-publishable`, then open a pull request.

Before anything is committed, `scripts/check-publishable.mjs` refuses to let private material into
the repository — documents, databases, `.env` files and your own prepared content. It runs in CI on
every pull request.

## Security

Found a vulnerability? Please read **[SECURITY.md](SECURITY.md)** and report it privately rather than
in a public issue.

## Code of conduct

This project is used mostly by students. Participation is governed by our
**[Code of Conduct](CODE_OF_CONDUCT.md)**.

## Licence

MIT — see [LICENSE](LICENSE).
