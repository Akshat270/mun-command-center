-- MUN Live Command Center — schema
-- Engine: node:sqlite (Node 24 built-in). FTS5 verified available.
-- All IDs are stable TEXT (nanoid-ish) so records survive re-import and export.

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA synchronous = NORMAL;

-- ---------------------------------------------------------------- documents

CREATE TABLE IF NOT EXISTS documents (
  id            TEXT PRIMARY KEY,
  path          TEXT NOT NULL,              -- absolute path to the ORIGINAL, never modified
  filename      TEXT NOT NULL,
  title         TEXT NOT NULL,
  category      TEXT NOT NULL DEFAULT 'Other',
  country       TEXT,                       -- ISO-ish code: CA / AT / AR / NP / NULL
  source_type   TEXT NOT NULL DEFAULT 'research',
  priority      INTEGER NOT NULL DEFAULT 3, -- 1 competition, 2 official/primary, 3 research, 4 AI
  verified      INTEGER NOT NULL DEFAULT 0,
  pinned        INTEGER NOT NULL DEFAULT 0,
  archived      INTEGER NOT NULL DEFAULT 0,
  notes         TEXT,
  hash          TEXT,                       -- sha256 of extracted text, for duplicate detection
  page_count    INTEGER,
  char_count    INTEGER,
  parse_status  TEXT NOT NULL DEFAULT 'ok', -- ok | failed | empty
  parse_error   TEXT,
  added_at      TEXT NOT NULL,
  indexed_at    TEXT
);

CREATE INDEX IF NOT EXISTS idx_documents_category ON documents(category);
CREATE INDEX IF NOT EXISTS idx_documents_country  ON documents(country);
CREATE UNIQUE INDEX IF NOT EXISTS idx_documents_path ON documents(path);

-- ------------------------------------------------------------------ chunks

CREATE TABLE IF NOT EXISTS chunks (
  id           TEXT PRIMARY KEY,
  document_id  TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  ordinal      INTEGER NOT NULL,
  text         TEXT NOT NULL,
  page         INTEGER,                     -- NULL => UI shows "Page unavailable"
  heading      TEXT,
  section      TEXT,
  char_count   INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_chunks_document ON chunks(document_id, ordinal);

-- FTS5 external-content index over chunks. bm25() gives keyword ranking.
CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
  text,
  heading,
  content='chunks',
  content_rowid='rowid',
  tokenize='porter unicode61 remove_diacritics 2'
);

CREATE TRIGGER IF NOT EXISTS chunks_ai AFTER INSERT ON chunks BEGIN
  INSERT INTO chunks_fts(rowid, text, heading) VALUES (new.rowid, new.text, new.heading);
END;
CREATE TRIGGER IF NOT EXISTS chunks_ad AFTER DELETE ON chunks BEGIN
  INSERT INTO chunks_fts(chunks_fts, rowid, text, heading) VALUES ('delete', old.rowid, old.text, old.heading);
END;
CREATE TRIGGER IF NOT EXISTS chunks_au AFTER UPDATE ON chunks BEGIN
  INSERT INTO chunks_fts(chunks_fts, rowid, text, heading) VALUES ('delete', old.rowid, old.text, old.heading);
  INSERT INTO chunks_fts(rowid, text, heading) VALUES (new.rowid, new.text, new.heading);
END;

-- Optional semantic tier. Float32 BLOB; brute-force cosine in JS is <10ms at this scale.
CREATE TABLE IF NOT EXISTS embeddings (
  chunk_id  TEXT PRIMARY KEY REFERENCES chunks(id) ON DELETE CASCADE,
  vec       BLOB NOT NULL,
  dim       INTEGER NOT NULL,
  model     TEXT NOT NULL
);

-- --------------------------------------------------------------- countries

CREATE TABLE IF NOT EXISTS countries (
  code               TEXT PRIMARY KEY,
  name               TEXT NOT NULL,
  flag               TEXT,
  is_ours            INTEGER NOT NULL DEFAULT 0,
  bloc_status        TEXT NOT NULL DEFAULT 'neutral', -- strong_ally|potential_ally|neutral|opposed|strongly_opposed
  identity           TEXT,
  lead_topic         TEXT,
  main_vulnerability TEXT,
  position           TEXT,
  facts              TEXT,   -- JSON array
  legal_refs         TEXT,   -- JSON array
  strengths          TEXT,   -- JSON array
  vulnerabilities    TEXT,   -- JSON array
  attacks_defenses   TEXT,   -- JSON array of {attack, defense}
  questions_to_ask   TEXT,   -- JSON array
  likely_allies      TEXT,
  likely_opponents   TEXT,
  cooperation        TEXT,
  resolution_fit     TEXT,
  should_lead_on     TEXT,   -- JSON array
  caution            TEXT,
  source_doc         TEXT,
  updated_at         TEXT
);

-- ---------------------------------------------------------------- speeches

CREATE TABLE IF NOT EXISTS speeches (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  category    TEXT NOT NULL,      -- opening|30s|45s|60s|moderated|closing|emergency
  duration_s  INTEGER,
  body        TEXT NOT NULL,
  memory_hook TEXT,
  tags        TEXT,               -- JSON array
  pinned      INTEGER NOT NULL DEFAULT 0,
  used_at     TEXT,
  use_count   INTEGER NOT NULL DEFAULT 0,
  source_doc  TEXT,
  ordinal     INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_speeches_category ON speeches(category, ordinal);

-- -------------------------------------------------------------------- POIs

CREATE TABLE IF NOT EXISTS pois (
  id                TEXT PRIMARY KEY,
  target_country    TEXT NOT NULL DEFAULT 'ANY',
  topic             TEXT,
  question          TEXT NOT NULL,
  purpose           TEXT,
  expected_response TEXT,
  follow_up         TEXT,
  strength          TEXT NOT NULL DEFAULT 'medium', -- strong|medium|weak
  asked_at          TEXT,
  outcome           TEXT,
  pinned            INTEGER NOT NULL DEFAULT 0,
  hidden            INTEGER NOT NULL DEFAULT 0,
  source_doc        TEXT,
  ordinal           INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pois_target ON pois(target_country, ordinal);

-- -------------------------------------------------------------- Q&A defense

CREATE TABLE IF NOT EXISTS qa (
  id         TEXT PRIMARY KEY,
  question   TEXT NOT NULL,
  answer     TEXT NOT NULL,
  kind       TEXT NOT NULL DEFAULT 'likely_to_us', -- likely_to_us|rapid_response|general
  short      TEXT,
  tags       TEXT,
  pinned     INTEGER NOT NULL DEFAULT 0,
  source_doc TEXT,
  ordinal    INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_qa_kind ON qa(kind, ordinal);

-- Which prepared answers belong to which speech. A speech invites particular
-- questions; when one lands the answer has to be one glance away, not a search.
-- Many-to-many on purpose: the Five Eyes answer follows every speech.
CREATE TABLE IF NOT EXISTS speech_qa (
  speech_id  TEXT NOT NULL REFERENCES speeches(id) ON DELETE CASCADE,
  qa_id      TEXT NOT NULL REFERENCES qa(id) ON DELETE CASCADE,
  ordinal    INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  PRIMARY KEY (speech_id, qa_id)
);

CREATE INDEX IF NOT EXISTS idx_speech_qa_speech ON speech_qa(speech_id, ordinal);
CREATE INDEX IF NOT EXISTS idx_speech_qa_qa     ON speech_qa(qa_id);

-- ------------------------------------------------------------------- notes

CREATE TABLE IF NOT EXISTS notes (
  id         TEXT PRIMARY KEY,
  body       TEXT NOT NULL,
  badge      TEXT NOT NULL DEFAULT 'FACT',  -- FACT|ARGUMENT|OPINION|AI
  country    TEXT,
  tags       TEXT,
  pinned     INTEGER NOT NULL DEFAULT 0,
  session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_notes_created ON notes(created_at DESC);

-- ---------------------------------------------------------------- sessions

CREATE TABLE IF NOT EXISTS sessions (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  phase         TEXT NOT NULL DEFAULT 'roll_call',
  topic         TEXT,
  caucus_type   TEXT,
  current_speaker TEXT,
  roll_call     TEXT,             -- "Present" | "Present and Voting" | NULL (never auto-chosen)
  started_at    TEXT NOT NULL,
  ended_at      TEXT,
  summary_json  TEXT
);

-- The chair's General Speakers List.
--
-- `sessions.current_speaker` is a single name and cannot answer the question a
-- delegate actually asks every few minutes: how long until it is my turn. The
-- queue lives here, and `current_speaker` is kept in step with the row marked
-- 'speaking' so the two can never disagree.
CREATE TABLE IF NOT EXISTS speakers_list (
  id           TEXT PRIMARY KEY,
  session_id   TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,          -- as the chair read it out
  country_code TEXT,                   -- resolved when it is a member state
  ordinal      INTEGER NOT NULL,
  status       TEXT NOT NULL DEFAULT 'waiting',  -- waiting|speaking|done|skipped
  started_at   TEXT,
  ended_at     TEXT,
  seconds      INTEGER,                -- actually spoken, for review afterwards
  note         TEXT
);

CREATE INDEX IF NOT EXISTS idx_speakers_session ON speakers_list(session_id, ordinal);

CREATE TABLE IF NOT EXISTS transcript_segments (
  id             TEXT PRIMARY KEY,
  session_id     TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  speaker        TEXT NOT NULL DEFAULT 'Unknown',
  country        TEXT,
  text           TEXT NOT NULL,
  ts             TEXT NOT NULL,
  source         TEXT NOT NULL DEFAULT 'manual', -- manual|webspeech|import
  classification TEXT,            -- QUESTION|ATTACK|PROPOSAL|FACTUAL_CLAIM|MOTION|PROCEDURAL|IRRELEVANT
  relevance      REAL,
  analyzed       INTEGER NOT NULL DEFAULT 0,
  pinned         INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_segments_session ON transcript_segments(session_id, ts);

CREATE TABLE IF NOT EXISTS ai_analyses (
  id          TEXT PRIMARY KEY,
  kind        TEXT NOT NULL,      -- respond|defense|clause_check|summary|practice
  input_text  TEXT NOT NULL,
  segment_id  TEXT REFERENCES transcript_segments(id) ON DELETE SET NULL,
  session_id  TEXT,
  output_json TEXT NOT NULL,
  citations   TEXT,               -- JSON array of chunk ids actually used
  model       TEXT,
  latency_ms  INTEGER,
  confidence  TEXT,
  created_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_analyses_created ON ai_analyses(created_at DESC);

-- ------------------------------------------------------------- resolutions

CREATE TABLE IF NOT EXISTS resolutions (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  committee   TEXT NOT NULL DEFAULT 'UNGA',
  agenda      TEXT,
  sponsors    TEXT,               -- JSON array
  signatories TEXT,               -- JSON array
  open_issues TEXT,               -- JSON array
  is_active   INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  updated_at  TEXT
);

CREATE TABLE IF NOT EXISTS clauses (
  id            TEXT PRIMARY KEY,
  resolution_id TEXT NOT NULL REFERENCES resolutions(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL,    -- PRE | OP
  ordinal       INTEGER NOT NULL,
  parent_id     TEXT REFERENCES clauses(id) ON DELETE CASCADE,
  opener        TEXT,             -- "Recalling" / "Calls upon" ...
  text          TEXT NOT NULL,
  note          TEXT,
  flags_json    TEXT,             -- AI findings; never auto-applied
  created_at    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_clauses_res ON clauses(resolution_id, kind, ordinal);

-- Reusable clause ideas you want in the text (seeded from the content file).
CREATE TABLE IF NOT EXISTS clause_library (
  id         TEXT PRIMARY KEY,
  kind       TEXT NOT NULL DEFAULT 'OP',
  opener     TEXT,
  text       TEXT NOT NULL,
  topic      TEXT,
  priority   INTEGER NOT NULL DEFAULT 2,
  ordinal    INTEGER NOT NULL DEFAULT 0,
  source_doc TEXT
);

-- ------------------------------------------------------------- bloc board

CREATE TABLE IF NOT EXISTS bloc_members (
  country_code TEXT PRIMARY KEY,
  status       TEXT NOT NULL DEFAULT 'neutral',
  agreed       TEXT,
  disagreed    TEXT,
  proposed     TEXT,
  promises     TEXT,
  concerns     TEXT,
  contact      TEXT,
  updated_at   TEXT
);

-- -------------------------------------------------------------- procedure

CREATE TABLE IF NOT EXISTS procedure_rules (
  id         TEXT PRIMARY KEY,
  topic      TEXT NOT NULL,
  title      TEXT NOT NULL,
  body       TEXT NOT NULL,
  wording    TEXT,               -- exact motion wording where applicable
  source     TEXT NOT NULL DEFAULT 'GENERAL_PRACTICE', -- RPS_CONFIRMED|GENERAL_PRACTICE|NOT_SPECIFIED
  ordinal    INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_procedure_topic ON procedure_rules(topic, ordinal);

-- "If the room is X, motion for Y" — from the live cheat sheet.
CREATE TABLE IF NOT EXISTS caucus_plays (
  id         TEXT PRIMARY KEY,
  room_state TEXT NOT NULL,
  motion     TEXT NOT NULL,
  objective  TEXT NOT NULL,
  lead       TEXT,
  ordinal    INTEGER NOT NULL DEFAULT 0
);

-- ------------------------------------------------------- priorities/events

CREATE TABLE IF NOT EXISTS priorities (
  id      TEXT PRIMARY KEY,
  text    TEXT NOT NULL,
  done    INTEGER NOT NULL DEFAULT 0,
  ordinal INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS events (
  id      TEXT PRIMARY KEY,
  type    TEXT NOT NULL,
  label   TEXT NOT NULL,
  payload TEXT,
  at      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_events_at ON events(at DESC);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
