// Settings. API keys are never shown or edited here — the server reports
// presence only. Keys live in .env and never reach the browser.

import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { useApp } from '../lib/store'
import { Panel, Spinner } from '../components/ui'
import { SHORTCUTS } from '../lib/shortcuts'
import { providers, RECOGNITION_LANGUAGES } from '../lib/transcription'
import { MicCheck } from '../components/MicCheck'

export function Settings() {
  const { settings, status, saveSetting, refreshStatus, toast } = useApp()
  const [building, setBuilding] = useState(false)
  const [buildResult, setBuildResult] = useState<any>(null)

  useEffect(() => { refreshStatus() }, [refreshStatus])

  // The first build downloads the model and embeds every passage — too long to
  // hold a request open, so the server works in the background and this polls.
  const [progress, setProgress] = useState<any>(null)

  const buildIndex = async () => {
    setBuilding(true); setBuildResult(null); setProgress(null)
    try {
      await api.buildSemantic()
    } catch (e: any) {
      toast(e.message, 'bad'); setBuilding(false); return
    }

    const poll = async () => {
      try {
        const s = await api.semanticStatus()
        setProgress(s.building)
        if (s.building) { setTimeout(poll, 1200); return }

        setBuilding(false)
        const last = s.last
        setBuildResult(last)
        if (last?.status === 'built') toast(`Semantic index built — ${s.indexed} passages`, 'good')
        else if (last?.status === 'up-to-date') toast('Semantic index already up to date', 'info')
        else if (last?.status === 'unavailable' || last?.status === 'failed') toast(last.error, 'warn')
        refreshStatus()
      } catch {
        setBuilding(false)
        toast('Lost contact with the server while building.', 'bad')
      }
    }
    setTimeout(poll, 800)
  }

  if (!settings || !status) return <div className="p-4"><Spinner label="Loading settings…" /></div>

  const ai = status.ai
  const sem = status.semantic
  const speechAvailable = providers.webspeech.available

  return (
    <div className="p-4 flex flex-col gap-4 max-w-[820px]">
      <CommitteePanel />

      {/* AI */}
      <Panel title="AI">
        <div className="divide-line text-[13px]">
          <Row label="Status" value={
            <span style={{ color: ai.available ? 'var(--color-good)' : 'var(--color-warn)' }}>
              {ai.available ? `Ready via ${ai.provider}` : 'Not configured'}
            </span>
          } />
          <Row label="Live model" value={<span className="mono">{ai.models.live}</span>}
            hint="Fast and cheap — used for Respond To This and transcript classification." />
          <Row label="Deep model" value={<span className="mono">{ai.models.deep}</span>}
            hint="Used for Defense Mode, clause review, session summary and practice evaluation." />
          <Row label="Classifier" value={<span className="mono">{ai.models.classify}</span>}
            hint="Only runs on segments the local rules cannot classify — most cost nothing." />
          <KeyPanel onChange={refreshStatus} />
        </div>
      </Panel>

      {/* Knowledge base */}
      <Panel title="Knowledge base">
        <div className="divide-line text-[13px]">
          <Row label="Documents" value={`${status.counts.documents} imported`} />
          <Row label="Passages" value={`${status.counts.chunks} indexed for keyword search`} />
          <Row label="Source folder" value={<span className="mono text-[11px]">{status.sourceDir}</span>}
            hint="Read-only. Originals are never modified." />
          <Row label="Database" value={<span className="mono text-[11px]">{status.db.path}</span>}
            hint="Kept outside OneDrive — a syncing folder can lock or corrupt a live database." />
          <div className="px-3 py-2.5">
            <div className="flex items-center justify-between gap-3 mb-1">
              <div>
                <div className="section-title">Semantic search (optional)</div>
                <p className="text-[12px] mt-0.5" style={{ color: 'var(--muted)' }}>{sem.note}</p>
              </div>
              <button className="btn btn-primary shrink-0" onClick={buildIndex} disabled={building}>
                {building ? 'Building…' : sem.built ? 'Update index' : 'Build semantic index'}
              </button>
            </div>
            {building && (
              <div className="mt-1.5">
                <div className="text-[12px] mb-1" style={{ color: 'var(--color-signal)' }}>
                  {progress?.total
                    ? `Indexing ${progress.done} of ${progress.total} passages…`
                    : 'Loading the embedding model — the first run downloads about 23 MB…'}
                </div>
                <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--panel-2)' }}>
                  <div className="h-full transition-all" style={{
                    background: 'var(--color-signal)',
                    width: progress?.total ? `${Math.round((progress.done / progress.total) * 100)}%` : '12%',
                  }} />
                </div>
              </div>
            )}
            {!building && sem.built && (
              <div className="text-[12px]" style={{ color: 'var(--color-good)' }}>
                ✓ {sem.indexed} / {sem.total} passages ({sem.coverage}%) · {sem.model}
              </div>
            )}
            {!building && buildResult?.error && (
              <div className="text-[12px] mt-1" style={{ color: 'var(--color-warn)' }}>{buildResult.error}</div>
            )}
            <div className="panel panel-2 p-2.5 mt-2 text-[12px]" style={{ color: 'var(--muted)' }}>
              <b>Do this before the 14th, while you have internet.</b> The model downloads once
              (~23 MB) and then works offline. Keyword search is fully offline either way — this only
              adds concept matching on top.
            </div>
          </div>
        </div>
      </Panel>

      {/* Transcription */}
      <Panel title="Transcription">
        <div className="divide-line text-[13px]">
          <Row label="Provider" value={
            <select className="select max-w-[220px]" value={settings.transcriptionProvider}
              onChange={(e) => saveSetting('transcriptionProvider', e.target.value)}>
              <option value="webspeech">Browser speech recognition</option>
              <option value="manual">Manual entry only</option>
            </select>
          } />
          <Row label="Recognition language" value={
            <select className="select max-w-[280px]" value={settings.transcriptionLang || 'en-GB'}
              onChange={(e) => saveSetting('transcriptionLang', e.target.value)}>
              {RECOGNITION_LANGUAGES.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
            </select>
          } hint="Takes effect the next time you press Start listening." />
          <Row label="Browser support" value={
            <span style={{ color: speechAvailable ? 'var(--color-good)' : 'var(--color-warn)' }}>
              {speechAvailable ? '✓ Available in this browser' : '✕ Not available — use Chrome or Edge'}
            </span>
          } hint="Browser speech recognition needs internet. Manual entry always works." />
          <Row label="Correct country & MUN terms" value={
            <select className="select max-w-[160px]"
              value={settings.transcriptionAutocorrect === false ? 'off' : 'on'}
              onChange={(e) => saveSetting('transcriptionAutocorrect', e.target.value === 'on')}>
              <option value="on">On (default)</option>
              <option value="off">Off — keep exactly what was heard</option>
            </select>
          } hint="Fixes phrases like “unmoderated cawcus”. Turn off if you ever see a word changed to something that was not said." />
          <Row label="Microphone" value={<MicCheck />}
            hint="Speak now — the bar should move. If it does not, nothing will be transcribed." />
          <Row label="Alert sensitivity" value={
            <select className="select max-w-[220px]" value={settings.alertSensitivity}
              onChange={(e) => saveSetting('alertSensitivity', e.target.value)}>
              <option value="low">Low — only strong signals</option>
              <option value="medium">Medium (default)</option>
              <option value="high">High — alert often</option>
            </select>
          } hint="How readily the Live Room raises a ⚡ possible-response alert." />
        </div>
      </Panel>

      {/* Privacy */}
      <Panel title="Privacy & recording">
        <div className="px-3 py-2.5 text-[13px] flex flex-col gap-2">
          <ul className="flex flex-col gap-1" style={{ color: 'var(--muted)' }}>
            <li>• Recording never starts on its own — you press the button every time.</li>
            <li>• A red ● RECORDING indicator is visible for the whole time it is on.</li>
            <li>• Transcripts are stored locally on this laptop, in the database above.</li>
            <li>• No audio file is uploaded anywhere by this app.</li>
            <li>• You can delete any transcript line, or an entire session, at any time.</li>
          </ul>
          <div className="panel panel-2 p-2.5" style={{ borderColor: 'var(--color-warn)' }}>
            <div className="section-title mb-1" style={{ color: 'var(--color-warn)' }}>Conference rules</div>
            <p style={{ color: 'var(--muted)' }}>
              Recording and transcription are subject to your conference's rules and to applicable
              law. Follow the RPSIS rules and obtain any permission required before recording in the
              committee room. If in doubt, ask the Chair and use manual transcript entry.
            </p>
          </div>
          <div>
            <button className="btn btn-sm" onClick={() => saveSetting('recordingConsentAck', false)}>
              Reset recording acknowledgement
            </button>
          </div>
        </div>
      </Panel>

      {/* Appearance */}
      <Panel title="Appearance">
        <div className="divide-line text-[13px]">
          <Row label="Theme" value={
            <select className="select max-w-[160px]" value={settings.theme}
              onChange={(e) => {
                saveSetting('theme', e.target.value)
                document.documentElement.setAttribute('data-theme', e.target.value)
              }}>
              <option value="dark">Dark (recommended)</option>
              <option value="light">Light</option>
            </select>
          } />
          <Row label="Font size" value={
            <select className="select max-w-[160px]" value={settings.fontScale}
              onChange={(e) => {
                const v = Number(e.target.value)
                saveSetting('fontScale', v)
                document.documentElement.style.fontSize = `${v * 16}px`
              }}>
              <option value={0.9}>Small</option>
              <option value={1}>Normal</option>
              <option value={1.12}>Large</option>
              <option value={1.25}>Extra large</option>
            </select>
          } hint="Larger text helps when glancing at the screen mid-speech." />
        </div>
      </Panel>

      {/* Shortcuts */}
      <Panel title="Keyboard shortcuts">
        <div className="grid sm:grid-cols-2 gap-x-6 px-3 py-2">
          {SHORTCUTS.map((s) => (
            <div key={s.keys} className="flex items-center justify-between gap-3 py-1 text-[13px]">
              <span>{s.label}</span>
              <span className="flex gap-1">
                {s.keys.split(' ').map((k) => <span key={k} className="kbd">{k}</span>)}
              </span>
            </div>
          ))}
        </div>
      </Panel>

      <Panel title="Reset">
        <div className="px-3 py-2.5 flex flex-wrap gap-2">
          <button className="btn" onClick={async () => {
            await api.post('/api/seed', { force: true }).catch(() => {})
            toast('Curated content reloaded', 'good'); refreshStatus()
          }}>Reload curated content</button>
          <button className="btn" onClick={async () => {
            await api.del('/api/search/semantic').catch(() => {})
            toast('Semantic index cleared', 'info'); refreshStatus()
          }}>Clear semantic index</button>
        </div>
        <p className="px-3 pb-2.5 text-[11px]" style={{ color: 'var(--faint)' }}>
          Reloading curated content refreshes speeches, POIs, defences, country profiles and procedure
          cards from the shipped set. Your own edits to those records are replaced; notes, transcript,
          bloc board, resolution, asked-POI marks and used-speech counts are preserved.
        </p>
      </Panel>
    </div>
  )
}

// ───────────────────────────────────────────────────────────── API keys
//
// The key is typed here, posted once to the local server, and never comes back.
// Everything shown afterwards is presence, provenance and a masked hint.

const PROVIDER_LABEL: Record<string, string> = {
  anthropic: 'Anthropic (Claude)', openai: 'OpenAI', google: 'Google (Gemini)',
  'claude-cli': 'Claude subscription',
}
// The shape of each key, so a paste into the wrong row is obvious immediately.
const KEY_PLACEHOLDER: Record<string, string> = {
  anthropic: 'sk-ant-…', openai: 'sk-…', google: 'AIza…',
}
const CONSOLE_URL: Record<string, string> = {
  anthropic: 'https://console.anthropic.com/settings/keys',
  openai: 'https://platform.openai.com/api-keys',
  google: 'https://aistudio.google.com/app/apikey',
}

function KeyPanel({ onChange }: { onChange: () => void }) {
  const { toast, status } = useApp()
  const [providers, setProviders] = useState<any[]>([])
  const [entry, setEntry] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [cli, setCli] = useState<any>(null)
  const [selected, setSelected] = useState<string>('anthropic')
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<any>(null)

  const load = () => {
    api.aiKeys().then((r) => {
      setProviders(r.providers); setCli(r.claudeCli); setSelected(r.status.selected || 'anthropic')
    }).catch(() => {})
  }
  useEffect(load, [])

  // 'claude-cli' has no key — it authenticates through the installed CLI, which
  // has its own separate warning below.
  const selectedNeedsKey = selected !== 'claude-cli' &&
    providers.length > 0 &&
    !providers.find((p) => p.provider === selected)?.configured

  const chooseProvider = async (name: string) => {
    setSelected(name); setTestResult(null)
    try { await api.setAiProvider(name); onChange(); load() }
    catch (e: any) { toast(e.message, 'bad') }
  }

  const runTest = async () => {
    setTesting(true); setTestResult(null)
    try {
      const r = await api.testAi()
      setTestResult(r)
      toast(r.ok ? `AI works — replied in ${(r.elapsedMs / 1000).toFixed(1)}s` : r.reason,
        r.ok ? 'good' : 'warn')
      onChange()
    } catch (e: any) { toast(e.message, 'bad') } finally { setTesting(false) }
  }

  const save = async (provider: string) => {
    const key = (entry[provider] || '').trim()
    if (!key) return
    setBusy(provider)
    try {
      const res = await api.saveAiKey(provider, key)
      setProviders(res.providers)
      setEntry({ ...entry, [provider]: '' })
      setOpen(null)
      toast(res.verified ? 'Key verified and saved — AI is now available.' : res.note,
        res.verified ? 'good' : 'warn')
      onChange()
    } catch (e: any) { toast(e.message, 'bad') } finally { setBusy(null) }
  }

  const remove = async (provider: string) => {
    setBusy(provider)
    try {
      const res = await api.removeAiKey(provider)
      setProviders(res.providers)
      toast('Key removed.', 'info')
      onChange()
    } catch (e: any) { toast(e.message, 'bad') } finally { setBusy(null) }
  }

  return (
    <div className="px-3 py-2.5">
      {/* Where the AI comes from. Two genuinely different deals, so the choice
          is spelled out rather than hidden behind a provider dropdown. */}
      <div className="section-title mb-2">Where AI comes from</div>
      <div className="grid sm:grid-cols-2 gap-2 mb-3">
        <button className="panel panel-2 px-3 py-2.5 text-left"
          style={selected === 'claude-cli' ? { borderColor: 'var(--color-signal)' } : {}}
          onClick={() => chooseProvider('claude-cli')}>
          <div className="flex items-center gap-2">
            <span>{selected === 'claude-cli' ? '◉' : '○'}</span>
            <span className="text-[13px] font-medium">Your Claude subscription</span>
            {cli && (
              <span className="chip" style={{ color: cli.available ? 'var(--color-good)' : 'var(--color-warn)' }}>
                {cli.available ? '✓ Claude Code found' : 'Claude Code not found'}
              </span>
            )}
          </div>
          <p className="text-[11px] mt-1.5" style={{ color: 'var(--muted)' }}>
            Runs through Claude Code on this laptop. <b>No per-token cost</b> — it draws on the Pro/Max
            plan you already pay for. Slower: roughly 2 seconds for a transcript classification,
            15–20 seconds for a full analysis. Uses the same limits as your coding work.
          </p>
        </button>

        <button className="panel panel-2 px-3 py-2.5 text-left"
          style={selected === 'anthropic' ? { borderColor: 'var(--color-signal)' } : {}}
          onClick={() => chooseProvider('anthropic')}>
          <div className="flex items-center gap-2">
            <span>{selected === 'anthropic' ? '◉' : '○'}</span>
            <span className="text-[13px] font-medium">Anthropic API key</span>
            <span className="chip" style={{
              color: providers.find((p) => p.provider === 'anthropic')?.configured
                ? 'var(--color-good)' : 'var(--faint)',
            }}>
              {providers.find((p) => p.provider === 'anthropic')?.configured ? '✓ key set' : 'no key'}
            </span>
          </div>
          <p className="text-[11px] mt-1.5" style={{ color: 'var(--muted)' }}>
            Separate from the subscription — a prepaid balance, $5 minimum. Costs roughly 1.4¢ per
            analysis, about $2 for both competition days. <b>Fast enough for a live point of
            information</b> (under 10 seconds).
          </p>
        </button>

        {/* Gemini and OpenAI were accepted by the server but had no way to be
            chosen here, so a key saved for either sat unused while the app
            reported "AI unavailable". */}
        <button className="panel panel-2 px-3 py-2.5 text-left"
          style={selected === 'google' ? { borderColor: 'var(--color-signal)' } : {}}
          onClick={() => chooseProvider('google')}>
          <div className="flex items-center gap-2">
            <span>{selected === 'google' ? '◉' : '○'}</span>
            <span className="text-[13px] font-medium">Google Gemini API key</span>
            <span className="chip" style={{
              color: providers.find((p) => p.provider === 'google')?.configured
                ? 'var(--color-good)' : 'var(--faint)',
            }}>
              {providers.find((p) => p.provider === 'google')?.configured ? '✓ key set' : 'no key'}
            </span>
          </div>
          <p className="text-[11px] mt-1.5" style={{ color: 'var(--muted)' }}>
            A key from Google AI Studio, which has a free tier with rate limits — the usual choice if
            you have no Claude subscription and no prepaid balance. Fast. If the free tier's
            per-minute limit is hit mid-committee you will see a rate-limit message; everything
            except AI keeps working.
          </p>
        </button>

        <button className="panel panel-2 px-3 py-2.5 text-left"
          style={selected === 'openai' ? { borderColor: 'var(--color-signal)' } : {}}
          onClick={() => chooseProvider('openai')}>
          <div className="flex items-center gap-2">
            <span>{selected === 'openai' ? '◉' : '○'}</span>
            <span className="text-[13px] font-medium">OpenAI API key</span>
            <span className="chip" style={{
              color: providers.find((p) => p.provider === 'openai')?.configured
                ? 'var(--color-good)' : 'var(--faint)',
            }}>
              {providers.find((p) => p.provider === 'openai')?.configured ? '✓ key set' : 'no key'}
            </span>
          </div>
          <p className="text-[11px] mt-1.5" style={{ color: 'var(--muted)' }}>
            A prepaid balance, like the Anthropic option. Use it if this is the key you already have.
          </p>
        </button>
      </div>

      {/* The exact trap this app fell into: a key saved, but a different backend
          still selected, and a bare "AI unavailable" as the only symptom. */}
      {selectedNeedsKey && (
        <div className="panel panel-2 p-2.5 mb-3 text-[12px]" style={{ borderColor: 'var(--color-warn)' }}>
          <b style={{ color: 'var(--color-warn)' }}>
            {PROVIDER_LABEL[selected] || selected} is selected, but no key is saved for it.
          </b>{' '}
          {providers.some((p) => p.configured)
            ? `You do have a key for ${providers.filter((p) => p.configured).map((p) => PROVIDER_LABEL[p.provider] || p.provider).join(' and ')} — pick that backend above, or add a ${PROVIDER_LABEL[selected] || selected} key below.`
            : 'Add one below, then press Test AI now.'}
        </div>
      )}

      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <button className="btn btn-sm btn-primary" onClick={runTest} disabled={testing}>
          {testing ? 'Testing…' : 'Test AI now'}
        </button>
        {testResult && (
          <span className="text-[12px]" style={{ color: testResult.ok ? 'var(--color-good)' : 'var(--color-warn)' }}>
            {testResult.ok
              ? `✓ ${testResult.provider} replied "${testResult.reply}" in ${(testResult.elapsedMs / 1000).toFixed(1)}s`
              : `✕ ${testResult.reason}`}
          </span>
        )}
        {!testResult && (
          <span className="text-[11px]" style={{ color: 'var(--faint)' }}>
            One real round trip, so you know it works — and how fast — before the 14th.
          </span>
        )}
      </div>

      {selected === 'claude-cli' && cli && !cli.available && (
        <div className="panel panel-2 p-2.5 mb-3 text-[12px]" style={{ borderColor: 'var(--color-warn)' }}>
          <b style={{ color: 'var(--color-warn)' }}>Claude Code was not found on this machine.</b>{' '}
          Install it, then run <span className="mono">claude</span> once in a terminal and sign in
          with the account that has your subscription. Then press Test AI now.
        </div>
      )}

      {status?.ai?.unusedKeys?.length > 0 && (
        <div className="panel panel-2 p-2.5 mb-3 text-[12px]" style={{ borderColor: 'var(--color-warn)' }}>
          <b style={{ color: 'var(--color-warn)' }}>
            A key is stored for {status.ai.unusedKeys.join(', ')} but is not the selected backend.
          </b>{' '}
          It is not being used for anything. If you did not deliberately add it — a password manager
          can autofill these fields — remove it below and revoke it with the provider.
        </div>
      )}

      <div className="section-title mb-2">API keys</div>
      <div className="flex flex-col gap-2">
        {providers.map((p) => (
          <div key={p.provider} className="panel panel-2 px-3 py-2">
            <div className="flex items-center gap-2 flex-wrap">
              <span style={{ color: p.configured ? 'var(--color-good)' : 'var(--faint)' }}>
                {p.configured ? '✓' : '○'}
              </span>
              <span className="text-[13px] flex-1">{PROVIDER_LABEL[p.provider] || p.provider}</span>
              {p.configured && (
                <>
                  <span className="mono text-[11px]" style={{ color: 'var(--muted)' }}>{p.hint}</span>
                  <span className="chip">{p.source === 'env' ? 'from .env' : 'saved in app'}</span>
                </>
              )}
              <button className="btn btn-sm" disabled={busy === p.provider}
                onClick={() => setOpen(open === p.provider ? null : p.provider)}>
                {p.configured ? 'Replace' : 'Add key'}
              </button>
              {p.configured && p.source === 'saved' && (
                <button className="btn btn-sm" disabled={busy === p.provider}
                  onClick={() => remove(p.provider)}>Remove</button>
              )}
            </div>

            {p.configured && p.source === 'env' && (
              <p className="text-[11px] mt-1.5" style={{ color: 'var(--faint)' }}>
                This key comes from <span className="mono">app/.env</span>. Saving one here replaces it
                without a restart; to remove it entirely, delete the line from <span className="mono">.env</span>.
              </p>
            )}

            {open === p.provider && (
              <div className="mt-2 flex flex-col gap-2">
                <div className="flex gap-1.5">
                  {/* Password managers ignore autoComplete="off" but respect
                      "new-password" plus these vendor opt-outs. An autofilled
                      credential here would be sent to the provider on test. */}
                  <input className="input mono text-[12px]" type="password" autoFocus
                    autoComplete="new-password" spellCheck={false}
                    data-1p-ignore data-lpignore="true" data-bwignore data-form-type="other"
                    placeholder={KEY_PLACEHOLDER[p.provider] || 'Paste your key'}
                    value={entry[p.provider] || ''}
                    onChange={(e) => setEntry({ ...entry, [p.provider]: e.target.value })}
                    onKeyDown={(e) => { if (e.key === 'Enter') save(p.provider) }} />
                  <button className="btn btn-primary shrink-0" disabled={busy === p.provider}
                    onClick={() => save(p.provider)}>
                    {busy === p.provider ? 'Checking…' : 'Save & test'}
                  </button>
                </div>
                <p className="text-[11px]" style={{ color: 'var(--faint)' }}>
                  Get one at <span className="mono">{CONSOLE_URL[p.provider]}</span>. The key is sent
                  once to the local server on this laptop, tested against the provider, then stored in
                  the local database. It is never sent back to this page and never appears in a log.
                  Takes effect immediately — no restart.
                </p>
              </div>
            )}
          </div>
        ))}
      </div>
      <p className="text-[11px] mt-2" style={{ color: 'var(--faint)' }}>
        A rejected key is not saved. If you are offline the key is saved unverified and will start
        working once you have internet. Everything except AI works with no key at all.
      </p>
    </div>
  )
}

/**
 * Which delegation, committee and agenda you are representing.
 *
 * Everything downstream reads this: the top bar, the dashboard, the speakers
 * list, and every AI prompt. It is stored as the `committee` settings row, which
 * takes precedence over the MUN_* environment defaults and — unlike them —
 * survives re-seeding and needs no restart.
 *
 * Saved explicitly rather than on every keystroke. These fields are edited as a
 * set: writing a half-typed country name into the AI prompts of a session
 * already in progress is not a small annoyance, it is the app telling the model
 * you represent "Braz".
 */
function CommitteePanel() {
  const { status, refreshStatus, toast } = useApp()
  const committee = status?.committee
  const [form, setForm] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)

  // Re-seed the form whenever the stored committee changes, including the first
  // load — `status` is null on the very first render.
  useEffect(() => {
    if (!committee) return
    setForm({
      country: committee.country ?? '',
      countryCode: committee.countryCode ?? '',
      flag: committee.flag ?? '',
      committee: committee.committee ?? '',
      agenda: committee.agenda ?? '',
      conference: committee.conference ?? '',
      dates: committee.dates ?? '',
      allies: (committee.allies ?? []).join(', '),
    })
  }, [committee])

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }))

  const dirty = committee ? (
    form.country !== (committee.country ?? '') ||
    form.countryCode !== (committee.countryCode ?? '') ||
    form.flag !== (committee.flag ?? '') ||
    form.committee !== (committee.committee ?? '') ||
    form.agenda !== (committee.agenda ?? '') ||
    form.conference !== (committee.conference ?? '') ||
    form.dates !== (committee.dates ?? '') ||
    form.allies !== ((committee.allies ?? []).join(', '))
  ) : false

  const save = async () => {
    const country = form.country.trim()
    if (!country) { toast('A delegation name is required.', 'warn'); return }
    setSaving(true)
    try {
      await api.saveSettings({
        committee: {
          ...committee,
          country,
          // Uppercased and length-capped because it is matched against the
          // ISO codes on speakers and documents; a lowercase or padded value
          // silently stops "you are 4th in the list" from recognising you.
          countryCode: form.countryCode.trim().toUpperCase().slice(0, 2),
          flag: form.flag.trim(),
          committee: form.committee.trim() || 'UNGA',
          agenda: form.agenda.trim(),
          conference: form.conference.trim(),
          dates: form.dates.trim(),
          allies: form.allies
            .split(',')
            .map((c) => c.trim().toUpperCase())
            .filter(Boolean),
        },
      })
      await refreshStatus()
      toast('Committee saved — AI prompts follow it from the next request.', 'good')
    } catch (e: any) {
      toast(e.message || 'Could not save the committee.', 'bad')
    } finally { setSaving(false) }
  }

  if (!committee) return null

  const field = (key: string, label: string, placeholder: string, hint?: string) => (
    <div>
      <div className="section-title mb-1">{label}</div>
      <input className="input" value={form[key] ?? ''} onChange={set(key)} placeholder={placeholder} />
      {hint && <p className="text-[11px] mt-1" style={{ color: 'var(--faint)' }}>{hint}</p>}
    </div>
  )

  return (
    <Panel title="Committee">
      <div className="p-3 flex flex-col gap-3">
        <p className="text-[12px]" style={{ color: 'var(--muted)' }}>
          Your assignment. The top bar, dashboard, speakers list and every AI prompt read these —
          set them once and the whole app follows, whichever country and committee you have.
        </p>

        <div className="grid sm:grid-cols-2 gap-3">
          {field('country', 'Delegation', 'Brazil')}
          {field('countryCode', 'Country code', 'BR', 'ISO 3166 alpha-2. Used to match you in the speakers list.')}
          {field('committee', 'Committee', 'UNGA', 'UNGA, ECOSOC, UNSC, HRC…')}
          {field('conference', 'Conference', 'Springfield MUN 2026')}
        </div>

        {field('agenda', 'Agenda', 'The topic as the conference words it')}

        <div className="grid sm:grid-cols-3 gap-3">
          {field('flag', 'Flag', '🇧🇷', 'Optional, shown in the top bar.')}
          {field('dates', 'Dates', '14–15 August 2026', 'Optional.')}
          {field('allies', 'Coordinating with', 'AT, AR, NP',
            'Optional. Country codes, comma separated — the AI treats them as partners and never speaks for them.')}
        </div>

        <div className="flex items-center gap-2">
          <button className="btn btn-primary" onClick={save} disabled={!dirty || saving}>
            {saving ? 'Saving…' : 'Save committee'}
          </button>
          {dirty && !saving && (
            <span className="text-[11px]" style={{ color: 'var(--color-warn)' }}>Unsaved changes</span>
          )}
        </div>
      </div>
    </Panel>
  )
}

function Row({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="px-3 py-2">
      <div className="flex items-center justify-between gap-3">
        <span className="section-title">{label}</span>
        <span>{value}</span>
      </div>
      {hint && <p className="text-[11px] mt-1" style={{ color: 'var(--faint)' }}>{hint}</p>}
    </div>
  )
}
