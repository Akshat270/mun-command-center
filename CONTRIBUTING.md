# Contributing

Thanks for wanting to help. This project is used by students preparing for Model UN conferences,
often on the morning of the conference, so the bar for "does not break" is higher than the bar for
"has more features".

**You never need an API key, a password, or any credential to contribute.** The app runs fully
without one and the entire test suite passes without one. If something seems to require a secret,
that is a bug — please report it.

---

## Getting set up

Requires **Node.js 22.5+** (the app uses Node's built-in SQLite — nothing to compile).

```bash
# Fork the repository on GitHub first, then:
git clone https://github.com/<your-username>/mun-command-center.git
cd mun-command-center/app
npm install
npm run dev          # Vite on :5180, API on :8788
```

The app seeds itself with committee-neutral example content from
`app/server/db/seed-data.example.js`, so it is usable immediately.

## Making a change

```bash
git checkout -b short-description-of-change
# ... edit ...
npm test                      # from app/
npm run build                 # must succeed
npm run check-publishable     # must exit 0 — see below
git commit -m "fix: speakers list crashed when a speaker was removed twice"
git push origin short-description-of-change
```

Then open a pull request against `main`. Fill in the template — particularly the box confirming your
change contains no private data.

`main` is protected: nobody pushes to it directly, including the maintainer. Everything lands through
a reviewed pull request.

---

## The one rule that matters most

**Never commit anyone's real preparation, documents, or data.**

This repository is public and Git history is permanent. A conference background guide, a delegate's
prepared speeches, or a database containing an API key cannot be un-published once pushed.

`scripts/check-publishable.mjs` enforces this and runs in CI on every pull request. It refuses:

| What | Why |
|---|---|
| `.docx` / `.pdf` / `.odt` / `.pptx` | Conference material is not ours to redistribute; prep material is someone's own work |
| `.db` / `.sqlite` | Databases hold API keys, notes and full session transcripts |
| `.env` (but not `.env.example`) | Contains API keys |
| `seed-data.local.js` | Someone's real speeches, POI bank and country research |
| `MUN-Data/` | The live data directory |
| `node/` | A bundled ~90 MB Node runtime — machine-specific, not source |

Run it yourself before pushing:

```bash
npm run check-publishable      # from app/
```

If you want to work with your own real prep, put it in `app/server/db/seed-data.local.js`. That file
is gitignored and the gate fails if it is ever staged. Do not "fix" the gate to make it pass — if it
objects to something, it is right.

**Contributions must be committee-neutral.** Do not add content, examples or defaults specific to one
country, agenda or conference. The example seed data uses "our delegation" rather than naming a state
for exactly this reason, and it should not put words in any real country's mouth.

---

## What makes a change easy to merge

- **One thing at a time.** A pull request that fixes a bug *and* reformats a file is hard to review.
- **Say what breaks without it.** "Advancing the speakers list recorded 0:00 after a page reload"
  tells a reviewer far more than "improve speakers list".
- **Match the surrounding code.** This codebase comments the *why*, not the *what* — when something
  looks odd, there is usually a paragraph explaining which failure it exists to prevent. Please keep
  that up; if you remove such a comment, explain why the reason no longer applies.
- **Add a test when you fix a bug.** `app/test/` uses Node's built-in test runner, no framework.
- **Do not add dependencies casually.** This has to install and run on a school laptop, sometimes
  from a pendrive, sometimes offline. A new dependency needs a reason in the pull request.

### Tests

```bash
npm test        # from app/
```

Most suites are self-contained. `workflow.test.js` and `resolution-import.test.js` are integration
tests that expect the server running on `:8788` (`npm run dev:server` in another terminal), and parts
of `workflow.test.js` additionally expect imported documents, so they are not run in CI. Everything
CI runs, you can run.

### Things that will be declined

- **Hosting or deployment configuration** (`vercel.json`, a Dockerfile intended for public hosting,
  and so on). The app has no authentication and no per-user separation; a hosted copy would pool
  every visitor's data and API keys into one database. See the README for the full reasoning.
- **Telemetry, analytics, or crash reporting.** The app does not phone home and will not start.
- **Anything that sends an API key, prompt, or transcript anywhere other than the provider the user
  chose.**
- **Weakening the loopback binding or the publication gate.**

---

## Reporting bugs

Open an issue using the bug template. The single most useful thing you can include is what you
expected to happen and what happened instead — plus your browser, since transcription behaves
differently across Chrome, Edge, Firefox and Safari.

**Do not paste an API key, a transcript, or your prepared material into an issue.** Redact first.
Security issues go through [SECURITY.md](SECURITY.md), privately, not into a public issue.
