// Thin API client. Every call resolves — network failures become readable
// messages rather than unhandled rejections, because the app must keep working
// when the server or the network is unavailable.

export class ApiError extends Error {
  status: number
  constructor(message: string, status = 0) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response
  // Only declare a JSON body when there actually is one. Sending
  // `content-type: application/json` with no body makes Fastify reject the
  // request outright — "Body cannot be empty when content-type is set to
  // application/json" — which broke every parameterless POST and DELETE.
  const headers: Record<string, string> = { ...(init?.headers as Record<string, string> || {}) }
  if (init?.body != null && !headers['content-type']) headers['content-type'] = 'application/json'

  try {
    res = await fetch(path, { ...init, headers })
  } catch {
    throw new ApiError('Cannot reach the local server. Is it still running?', 0)
  }
  const text = await res.text()
  let data: any = null
  if (text) {
    try { data = JSON.parse(text) } catch { data = { error: text } }
  }
  if (!res.ok) throw new ApiError(data?.error || `Request failed (${res.status})`, res.status)
  return data as T
}

const qs = (params: Record<string, unknown>) => {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') p.set(k, String(v))
  }
  const s = p.toString()
  return s ? `?${s}` : ''
}

export const api = {
  get: <T,>(path: string) => request<T>(path),
  post: <T,>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: JSON.stringify(body ?? {}) }),
  patch: <T,>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PATCH', body: JSON.stringify(body ?? {}) }),
  put: <T,>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PUT', body: JSON.stringify(body ?? {}) }),
  del: <T,>(path: string) => request<T>(path, { method: 'DELETE' }),

  status: () => request<any>('/api/status'),
  settings: () => request<any>('/api/settings'),
  saveSettings: (patch: Record<string, unknown>) =>
    request<any>('/api/settings', { method: 'PATCH', body: JSON.stringify(patch) }),

  // documents
  documents: (archived = false) => request<any>(`/api/documents${qs({ archived: archived ? 1 : '' })}`),
  scan: (dir?: string) => request<any>(`/api/documents/scan${qs({ dir })}`),
  importAll: (dir?: string) => request<any>('/api/documents/import', { method: 'POST', body: JSON.stringify({ dir }) }),
  importOne: (path: string, overrides: Record<string, unknown> = {}) =>
    request<any>('/api/documents/import', { method: 'POST', body: JSON.stringify({ path, ...overrides }) }),
  document: (id: string) => request<any>(`/api/documents/${id}`),

  // search
  search: (q: string, opts: Record<string, unknown> = {}) => request<any>(`/api/search${qs({ q, ...opts })}`),
  globalSearch: (q: string) => request<any>(`/api/search/global${qs({ q })}`),
  source: (chunkId: string) => request<any>(`/api/search/source/${chunkId}`),
  buildSemantic: () => request<any>('/api/search/semantic/build', { method: 'POST' }),
  semanticStatus: () => request<any>('/api/search/semantic'),

  // content
  speeches: () => request<any[]>('/api/speeches'),
  pois: (target?: string, includeHidden = false) =>
    request<any[]>(`/api/pois${qs({ target, hidden: includeHidden ? 1 : '' })}`),
  reorderPois: (ids: string[]) =>
    request<any>('/api/pois/reorder', { method: 'POST', body: JSON.stringify({ ids }) }),
  qa: (kind?: string) => request<any[]>(`/api/qa${qs({ kind })}`),
  // Speech ⇄ defence-bank links. Each call replaces the whole set on one side,
  // so a save can never leave half a selection behind.
  linkSpeechQa: (speechId: string, ids: string[]) =>
    request<any>(`/api/speeches/${speechId}/qa`, { method: 'PUT', body: JSON.stringify({ ids }) }),
  linkQaSpeeches: (qaId: string, ids: string[]) =>
    request<any>(`/api/qa/${qaId}/speeches`, { method: 'PUT', body: JSON.stringify({ ids }) }),
  countries: () => request<any[]>('/api/countries'),
  country: (code: string) => request<any>(`/api/countries/${code}`),
  bloc: () => request<any[]>('/api/bloc'),
  notes: (session?: string) => request<any[]>(`/api/notes${qs({ session })}`),
  procedure: () => request<any>('/api/procedure'),
  priorities: () => request<any[]>('/api/priorities'),
  events: (limit = 25) => request<any[]>(`/api/events${qs({ limit })}`),
  clauseLibrary: () => request<any[]>('/api/clause-library'),

  // sessions & transcript
  sessions: () => request<any[]>('/api/sessions'),
  activeSession: () => request<any>('/api/sessions/active'),
  startSession: (name?: string) => request<any>('/api/sessions', { method: 'POST', body: JSON.stringify({ name }) }),
  transcript: (sessionId: string) => request<any[]>(`/api/transcript/${sessionId}`),
  addSegment: (body: Record<string, unknown>) =>
    request<any>('/api/transcript', { method: 'POST', body: JSON.stringify(body) }),

  // speakers list (GSL)
  speakers: (sessionId: string) => request<any[]>(`/api/speakers/${sessionId}`),
  addSpeakers: (body: Record<string, unknown>) =>
    request<any[]>('/api/speakers', { method: 'POST', body: JSON.stringify(body) }),
  patchSpeaker: (id: string, body: Record<string, unknown>) =>
    request<any[]>(`/api/speakers/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  removeSpeaker: (id: string) => request<any[]>(`/api/speakers/${id}`, { method: 'DELETE' }),
  reorderSpeakers: (body: Record<string, unknown>) =>
    request<any[]>('/api/speakers/reorder', { method: 'POST', body: JSON.stringify(body) }),
  advanceSpeaker: (body: Record<string, unknown>) =>
    request<any>('/api/speakers/advance', { method: 'POST', body: JSON.stringify(body) }),

  // resolutions
  resolutions: () => request<any[]>('/api/resolutions'),
  resolution: (id: string) => request<any>(`/api/resolutions/${id}`),
  resolutionText: (id: string) => request<any>(`/api/resolutions/${id}/text`),
  importResolution: (body: Record<string, unknown>) =>
    request<any>('/api/resolutions/import', { method: 'POST', body: JSON.stringify(body) }),

  // ai
  aiStatus: () => request<any>('/api/ai/status'),
  aiKeys: () => request<any>('/api/ai/keys'),
  saveAiKey: (provider: string, key: string) =>
    request<any>('/api/ai/key', { method: 'POST', body: JSON.stringify({ provider, key }) }),
  removeAiKey: (provider: string) => request<any>(`/api/ai/key/${provider}`, { method: 'DELETE' }),
  setAiProvider: (provider: string) =>
    request<any>('/api/ai/provider', { method: 'POST', body: JSON.stringify({ provider }) }),
  testAi: () => request<any>('/api/ai/test', { method: 'POST' }),
  respond: (body: Record<string, unknown>) => request<any>('/api/ai/respond', { method: 'POST', body: JSON.stringify(body) }),
  defense: (body: Record<string, unknown>) => request<any>('/api/ai/defense', { method: 'POST', body: JSON.stringify(body) }),
  checkClause: (body: Record<string, unknown>) => request<any>('/api/ai/clause', { method: 'POST', body: JSON.stringify(body) }),
  summary: (sessionId: string) => request<any>('/api/ai/summary', { method: 'POST', body: JSON.stringify({ sessionId }) }),
  practiceChallenge: (body: Record<string, unknown>) =>
    request<any>('/api/ai/practice/challenge', { method: 'POST', body: JSON.stringify(body) }),
  practiceEvaluate: (body: Record<string, unknown>) =>
    request<any>('/api/ai/practice/evaluate', { method: 'POST', body: JSON.stringify(body) }),
  analyses: (limit = 20) => request<any[]>(`/api/ai/analyses${qs({ limit })}`),

  exportSession: (sessionId: string) => request<any>(`/api/export/${sessionId}`),
}
