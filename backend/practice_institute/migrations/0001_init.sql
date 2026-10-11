-- Practice Institute schema v1. All timestamps are UTC epoch milliseconds (server clock).

CREATE TABLE admins (
  id            INTEGER PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,           -- argon2id (argon2-cffi)
  role          TEXT NOT NULL DEFAULT 'owner' CHECK (role IN ('owner', 'editor')),
  created_at    INTEGER NOT NULL
);

CREATE TABLE admin_sessions (
  id          INTEGER PRIMARY KEY,
  token_hash  TEXT NOT NULL UNIQUE,      -- sha256 of the cookie value; raw token never stored
  csrf_token  TEXT NOT NULL,             -- must be echoed in X-CSRF-Token on mutations
  admin_id    INTEGER NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL
);

-- Uploaded past papers (originals kept under data/sources/, never redistributed).
CREATE TABLE sources (
  id           INTEGER PRIMARY KEY,
  filename     TEXT NOT NULL,
  sha256       TEXT NOT NULL UNIQUE,
  size_bytes   INTEGER NOT NULL,
  page_count   INTEGER,
  label        TEXT NOT NULL,
  exam_body    TEXT,                     -- e.g. CTET, UGC-NET
  year         TEXT,
  subject      TEXT,
  synthetic    INTEGER NOT NULL DEFAULT 0,
  provenance   TEXT NOT NULL DEFAULT '', -- where it came from / licence / consent note
  stored_path  TEXT,
  created_at   INTEGER NOT NULL
);

-- Question bank. English and Hindi are stored side-by-side as ORIGINAL extracted text;
-- a NULL language field means "not present in source" (never machine-translated).
CREATE TABLE questions (
  id            INTEGER PRIMARY KEY,
  source_id     INTEGER REFERENCES sources(id) ON DELETE SET NULL,
  source_number INTEGER,
  source_page   INTEGER,
  crop_json     TEXT,                    -- {"page":n,"x":..,"y":..,"w":..,"h":..} normalised 0..1
  subject       TEXT,
  year          TEXT,
  context_en    TEXT,
  context_hi    TEXT,
  stem_en       TEXT,
  stem_hi       TEXT,
  options_json  TEXT NOT NULL,           -- [{"key":"A","en":..,"hi":..}, ...]
  answer_key    TEXT,                    -- verified correct key or NULL
  explanation_en TEXT,
  explanation_hi TEXT,
  status        TEXT NOT NULL DEFAULT 'needs-review'
                CHECK (status IN ('needs-review', 'reviewed', 'excluded')),
  origin        TEXT NOT NULL DEFAULT 'manual'
                CHECK (origin IN ('manual', 'text-layer', 'ocr', 'import')),
  warnings_json TEXT NOT NULL DEFAULT '[]',
  version       INTEGER NOT NULL DEFAULT 1,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  CHECK (stem_en IS NOT NULL OR stem_hi IS NOT NULL)
);
CREATE INDEX questions_status ON questions(status);

CREATE TABLE exams (
  id               INTEGER PRIMARY KEY,
  code             TEXT NOT NULL UNIQUE,  -- join code (enrolment only, not authorisation)
  title            TEXT NOT NULL,
  instructions     TEXT NOT NULL DEFAULT '',
  mode             TEXT NOT NULL CHECK (mode IN ('cohort', 'independent')),
  status           TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'closed')),
  scored           INTEGER NOT NULL DEFAULT 1,
  duration_s       INTEGER NOT NULL CHECK (duration_s > 0),
  opens_at         INTEGER NOT NULL,      -- cohort: common start; independent: window opens
  closes_at        INTEGER NOT NULL,      -- cohort: common end;   independent: window closes
  late_join_s      INTEGER NOT NULL DEFAULT 600,
  max_attempts     INTEGER NOT NULL DEFAULT 1,
  shuffle          TEXT NOT NULL DEFAULT 'fixed' CHECK (shuffle IN ('fixed', 'per-attempt')),
  marks_correct    REAL NOT NULL DEFAULT 1,
  marks_wrong      REAL NOT NULL DEFAULT 0,      -- negative marking entered as a positive penalty
  question_ids_json TEXT NOT NULL DEFAULT '[]',
  snapshot_json    TEXT,                  -- immutable copy frozen at publish (incl. keys)
  snapshot_sha256  TEXT,
  release_scores   INTEGER NOT NULL DEFAULT 0,
  release_answers  INTEGER NOT NULL DEFAULT 0,
  release_ranks    INTEGER NOT NULL DEFAULT 0,
  created_at       INTEGER NOT NULL,
  published_at     INTEGER,
  CHECK (closes_at > opens_at)
);

CREATE TABLE attempts (
  id             TEXT PRIMARY KEY,        -- random public id
  exam_id        INTEGER NOT NULL REFERENCES exams(id),
  alias          TEXT NOT NULL,
  alias_key      TEXT NOT NULL,           -- normalised alias for duplicate-join detection
  token_hash     TEXT NOT NULL UNIQUE,    -- sha256 of the resume secret
  status         TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'submitted', 'expired')),
  joined_at      INTEGER NOT NULL,
  started_at     INTEGER NOT NULL,        -- when the clock starts (cohort: exam opens_at)
  deadline_at    INTEGER NOT NULL,        -- authoritative server deadline
  finished_at    INTEGER,
  finish_reason  TEXT CHECK (finish_reason IN ('submitted', 'timeout')),
  order_json     TEXT NOT NULL,           -- snapshot question indices in display order
  last_seq       INTEGER NOT NULL DEFAULT 0,
  score          REAL,
  correct        INTEGER,
  wrong          INTEGER,
  unanswered     INTEGER,
  UNIQUE (exam_id, alias_key)
);
CREATE INDEX attempts_active_deadline ON attempts(status, deadline_at);

CREATE TABLE answers (
  attempt_id   TEXT NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
  qid          TEXT NOT NULL,             -- snapshot question id
  choice       TEXT,
  marked       INTEGER NOT NULL DEFAULT 0,
  seq          INTEGER NOT NULL,          -- client sequence that produced this value
  saved_at     INTEGER NOT NULL,
  PRIMARY KEY (attempt_id, qid)
);

CREATE TABLE audit_events (
  id         INTEGER PRIMARY KEY,
  at         INTEGER NOT NULL,
  actor      TEXT NOT NULL,               -- 'admin:<id>' | 'attempt:<id>' | 'system' | 'anon'
  action     TEXT NOT NULL,
  target     TEXT,
  detail     TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX audit_at ON audit_events(at);
