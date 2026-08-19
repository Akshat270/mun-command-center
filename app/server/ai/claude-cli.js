// Claude Code CLI provider — uses the Claude subscription already installed on
// this laptop instead of a metered API key.
//
// `claude -p` is Anthropic's documented headless mode: prompt in, answer out,
// authenticated as whoever is logged into Claude Code. That makes it free at
// the point of use for a Pro/Max subscriber, at the cost of latency (a process
// spawn per call, and no prompt caching between calls).
//
// Measured on this machine: ~2s for a short Haiku classification, ~15-20s for a
// full Sonnet analysis. Good enough for preparation, caucus work, clause review
// and practice. Slower than the API for a live point of information — which is
// why the provider is selectable rather than forced.
//
// Deliberate choices below:
//   · the prompt goes in on stdin, so a long retrieved context can never hit a
//     command-line length limit
//   · --system-prompt replaces Claude Code's coding-agent persona outright
//   · every tool is disallowed: this must answer, not read files or run commands
//   · cwd is the app data directory, so no CLAUDE.md is picked up
//   · --no-session-persistence, so committee transcripts leave nothing behind

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { modelsFor, DATA_DIR } from '../config.js'

// Tools are irrelevant to this job and a filesystem tool call would be both
// slow and wrong. Denying them is cheaper than trusting the prompt.
const NO_TOOLS = [
  'Bash', 'Read', 'Write', 'Edit', 'NotebookEdit', 'Glob', 'Grep',
  'WebFetch', 'WebSearch', 'Task', 'Agent', 'TodoWrite',
]

// The CLI takes aliases; full dated model IDs drift, aliases do not.
const MODEL_ALIAS = { live: 'sonnet', deep: 'opus', classify: 'haiku' }

// An explicit model id wins over the role: a caller that named a model meant it.
// The role is the fallback, for a call that only said what the work was.
function aliasFor(model, role) {
  if (model) {
    for (const [tier, id] of Object.entries(modelsFor('claude-cli'))) {
      if (model === id) return MODEL_ALIAS[tier] || 'sonnet'
    }
    if (/opus/i.test(model)) return 'opus'
    if (/haiku/i.test(model)) return 'haiku'
    if (/sonnet/i.test(model)) return 'sonnet'
  }
  return (role && MODEL_ALIAS[role]) || 'sonnet'
}

/**
 * Locate the Claude Code executable.
 *
 * Never spawned through a shell: the system prompt is passed as an argument and
 * can contain quotes, ampersands and newlines, which a shell would try to
 * interpret. Claude Code ships a real .exe on Windows, so CreateProcess can
 * resolve it from PATH directly with the argument list kept intact.
 */
function cliPath() {
  if (process.env.CLAUDE_CLI_PATH) return process.env.CLAUDE_CLI_PATH
  if (process.platform !== 'win32') return 'claude'
  const global = process.env.APPDATA &&
    path.join(process.env.APPDATA, 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe')
  if (global && fs.existsSync(global)) return global
  return 'claude.exe'   // resolved from PATH
}

/** Run the CLI with a prompt on stdin. Resolves to { code, stdout, stderr }. */
function runCLI(args, input, timeoutMs) {
  return new Promise((resolve, reject) => {
    let child
    try {
      child = spawn(cliPath(), args, { cwd: DATA_DIR, windowsHide: true })
    } catch (err) {
      reject(err); return
    }

    let stdout = '', stderr = '', settled = false
    const finish = (fn, arg) => { if (!settled) { settled = true; clearTimeout(timer); fn(arg) } }

    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      finish(reject, new Error(`Claude Code did not answer within ${Math.round(timeoutMs / 1000)}s.`))
    }, timeoutMs)

    child.stdout.on('data', (d) => { stdout += d })
    child.stderr.on('data', (d) => { stderr += d })
    child.on('error', (err) => finish(reject, err))
    child.on('close', (code) => finish(resolve, { code, stdout, stderr }))

    child.stdin.on('error', () => {})   // the child may exit before we finish writing
    child.stdin.end(input)
  })
}

let available = null   // cached probe result

export async function probeCLI() {
  try {
    const { code, stdout } = await runCLI(['--version'], '', 15_000)
    available = code === 0 && /claude code/i.test(stdout)
    return { available, version: available ? stdout.trim() : null }
  } catch {
    available = false
    return { available: false, version: null }
  }
}

export class ClaudeCLIProvider {
  name = 'claude-cli'

  // Presence of the CLI is what makes this usable — there is no key to check.
  // `null` means "not probed yet"; treat that as available so a first call can
  // report a real error rather than silently falling through to another provider.
  get configured() { return available !== false }

  async generate({ system, messages, model, role, maxTokens, effort }) {
    void maxTokens; void effort   // the CLI has no equivalent knobs

    // The conversation is flattened: headless mode is one prompt, one answer.
    const prompt = messages
      .map((m) => {
        const text = typeof m.content === 'string'
          ? m.content
          : m.content.map((c) => c.text || '').join('')
        return m.role === 'assistant' ? `[Your previous answer]\n${text}` : text
      })
      .join('\n\n')

    // Note: the output-format rules are appended by runAnalysis in final
    // position, for every provider. Claude Code needs them more than the API
    // does — it applies its own markdown presentation style — but there is one
    // source of truth for the format, not two.
    const args = [
      '-p',
      '--model', aliasFor(model, role),
      '--output-format', 'json',
      '--max-turns', '1',
      '--no-session-persistence',
      '--system-prompt', system,
      '--disallowed-tools', NO_TOOLS.join(' '),
    ]

    let res
    try {
      res = await runCLI(args, prompt, 90_000)
    } catch (err) {
      if (/ENOENT|not recognized|not found/i.test(err?.message || '')) {
        throw new Error(
          'Claude Code is not installed on this machine. Install it, run `claude` once to log in, ' +
          'or switch to an API key in Settings.'
        )
      }
      throw err
    }

    const raw = `${res.stdout}\n${res.stderr}`
    if (/not logged in|please log in|authentication|\/login/i.test(raw) && res.code !== 0) {
      throw new Error('Claude Code is not logged in. Open a terminal, run `claude`, sign in, then try again.')
    }
    if (/usage limit|rate limit|too many requests/i.test(raw)) {
      throw new Error(
        'Your Claude subscription has hit its usage limit. It resets on a rolling window — ' +
        'wait, or add an API key in Settings for the rest of the session.'
      )
    }

    let parsed
    try {
      parsed = JSON.parse(res.stdout.trim())
    } catch {
      if (res.code !== 0) {
        throw new Error(`Claude Code failed — ${(res.stderr || 'no output').trim().slice(0, 200)}`)
      }
      throw new Error('Claude Code returned something unreadable. Try again, or switch to an API key.')
    }

    if (parsed.is_error) {
      throw new Error(`Claude Code reported an error — ${String(parsed.result || '').slice(0, 200)}`)
    }
    const text = String(parsed.result ?? '')
    if (!text.trim()) {
      throw new Error('Claude Code returned an empty answer. Try again, or rephrase.')
    }

    return {
      text,
      model: `${aliasFor(model, role)} (via Claude Code)`,
      usage: {
        input: parsed.usage?.input_tokens ?? 0,
        output: parsed.usage?.output_tokens ?? 0,
        cacheRead: parsed.usage?.cache_read_input_tokens ?? 0,
        // What this WOULD have cost on the API. The subscription absorbs it —
        // shown so the delegate can see what they are saving, and judge whether
        // a key is worth buying for the live rounds.
        wouldHaveCostUsd: parsed.total_cost_usd ?? null,
      },
      billedToSubscription: true,
      latencyMs: parsed.duration_ms ?? null,
    }
  }

  // No token streaming in headless JSON mode: deliver the answer in one piece
  // rather than fake a stream that would finish at the same moment anyway.
  async *stream(opts) {
    const r = await this.generate(opts)
    yield { type: 'delta', text: r.text }
    yield { type: 'done', model: r.model, usage: r.usage }
  }
}
