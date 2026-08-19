## What this changes

<!-- One or two sentences. If it fixes a bug, say what went wrong. -->

## Why

<!-- What breaks, or is worse, without it? Link an issue if there is one. -->

## How to check it

<!-- Steps a reviewer can follow. "Start a session, add two speakers, press Next twice" -->

---

## Checklist

- [ ] **No private data.** No documents, databases, `.env` files, transcripts, API keys, or anyone's
      real prepared material. `seed-data.local.js` is not included.
- [ ] `npm run check-publishable` exits 0
- [ ] `npm test` passes
- [ ] `npm run build` succeeds
- [ ] **Committee-neutral.** No new content, defaults or examples tied to one country, agenda or
      conference.
- [ ] No new dependency — or the pull request explains why one is needed
- [ ] The app still works with no API key configured

<!--
A reminder rather than a rule: this app has no authentication and no per-user
separation, so changes that would make it safe to host publicly are not small
changes. Please read the "Do not deploy this to a shared server" section of the
README before adding deployment configuration.
-->
