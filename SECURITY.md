# Security

## Reporting a vulnerability

Please report security issues **privately**, not in a public issue.

Use GitHub's [private vulnerability reporting](https://docs.github.com/code-security/security-advisories/guidance-on-reporting-and-writing/privately-reporting-a-security-vulnerability)
on this repository — the **Security** tab → **Report a vulnerability**.

Please include what an attacker could actually do, the steps to reproduce, and the version or commit
you tested. **Do not include a real API key, a real transcript, or anyone's prepared material** —
redact them; a description is enough.

This is a small project maintained by one person alongside other work, so please allow a reasonable
window for a first response before disclosing publicly. Fixes are released as commits to `main`;
there is no separate patch channel.

---

## The security model, so you can judge what counts as a vulnerability

**This app has no authentication, and that is by design.** It is a desktop application that happens
to speak HTTP. Its entire security model is that it listens only on `127.0.0.1`, so nothing outside
your own computer can reach it.

There is no login because there is nothing multi-user to log into: no table has a user column, and
the app assumes exactly one trusted person at the keyboard.

**The absence of a login is therefore not a vulnerability.** What *would* be a vulnerability is
anything that lets something else reach the API — a way past the loopback binding, a way past the
`Host`-header check, a cross-site request that succeeds, or a path that exposes the API key.

### What is protected, and how

| Concern | Mitigation |
|---|---|
| A website reaching the local API via DNS rebinding | Requests must carry a `Host` header naming loopback, which a browser cannot forge |
| Accidental network exposure | A non-loopback `HOST` refuses to start unless `MUN_ALLOW_LAN=1` is also set, and warns on every boot |
| API key reaching the browser | The key travels browser → server once and is never returned; responses carry only presence, provenance and a masked hint (`sk-ant-…4f2a`) |
| API key in logs | The logger redacts `authorization`, `x-api-key`, `*.apiKey`, `*.api_key` |
| API key in the repository | `.env` is gitignored; `scripts/check-publishable.mjs` fails the build if one is ever staged |
| SQL injection | All queries are parameterised; the dynamic `UPDATE` builders iterate a fixed allowlist of column names, never user-supplied keys |
| Settings tampering | `PATCH /api/settings` accepts an explicit allowlist of keys; secrets are not among them |
| Path traversal in document import | Imports are confined to the configured source and data directories, verified after path resolution |
| Prompt injection reaching the shell | The Claude CLI provider is spawned without a shell, with every tool disallowed and session persistence off |
| Cross-origin reads in development | CORS names the dev server origin explicitly rather than reflecting any origin |

### Known and accepted limitations

These are deliberate trade-offs, not oversights. Please do not report them as vulnerabilities — but
do say so if you think the reasoning is wrong.

- **The API key is stored in plaintext** in the local SQLite database. Anyone with access to your
  user account on your machine can read it. Encrypting it at rest (OS keychain / DPAPI) is a wanted
  improvement, but on a single-user machine it raises the bar only slightly.
- **Setting `MUN_ALLOW_LAN=1` genuinely exposes everything** — transcript, notes, prepared speeches,
  and the ability to spend your API key — to anyone who can reach the port. That is what the flag
  means, and why it takes two deliberate settings and warns loudly.
- **Anyone with access to your machine can read your data.** There is no at-rest encryption of the
  database as a whole.

### Dependency advisories

`npm audit` currently reports **5 high-severity advisories, none with a fix available**. All of them
come from one place: `@huggingface/transformers`, which powers the optional semantic-search tier, and
which pulls in `onnxruntime-node` → `adm-zip` and `sharp` → `libvips`.

We have kept the dependency rather than shipping a broken feature, on this reasoning:

- The `adm-zip` issue is a memory-exhaustion denial of service when extracting a **crafted** archive.
  The only archive involved is the embedding model, fetched over HTTPS from Hugging Face and cached
  locally. Nothing a delegate types or imports reaches that code path.
- The `sharp`/`libvips` issues are in image decoding. This app embeds text only and never asks
  `sharp` to decode anything.
- Both would require an attacker who can already substitute files on your machine or intercept HTTPS,
  at which point they have easier targets — including the database itself.

That is an assessment, not a guarantee, and it is worth re-checking rather than trusting: the
advisories are real, and if a fixed version is published the dependency should be updated.

**If you would rather not have them at all**, the feature is genuinely optional — the code imports it
lazily and degrades to keyword search when it is absent. Remove `@huggingface/transformers` from
`app/package.json`, reinstall, and semantic search will report itself unavailable while everything
else works unchanged.

---

## Privacy: what leaves your machine

Two features send data outward. Both are optional and both are off until you act.

**Live transcription.** The browser's Web Speech API is not on-device in Chrome or Edge: while you
are listening, microphone audio from the room is streamed to Google's speech servers to be
transcribed. No audio file is saved or uploaded by this app, and the resulting transcript text stays
local — but the audio itself does leave. Selecting *Manual entry only* in Settings sends nothing.

Recording other people is also a legal question in many jurisdictions, and often a rules question at
your conference. The app asks for explicit acknowledgement before the first recording and shows an
unmissable indicator throughout.

**AI analysis.** When you use an AI feature, the prompt is sent to the provider you selected —
Anthropic, OpenAI or Google, or your local Claude Code CLI. That prompt contains retrieved passages
from your imported documents and recent transcript excerpts. It goes only to the provider you chose,
using your own key, and never through any service belonging to this project.

**Nothing else.** No telemetry, no analytics, no crash reporting, no update check. The maintainer of
this repository has no access to your data, your key, or the fact that you are running it at all.
