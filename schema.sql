CREATE TABLE IF NOT EXISTS schools (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  teacher_code TEXT NOT NULL UNIQUE,
  admin_code TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS faults (
  id TEXT PRIMARY KEY,
  school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  teacher_name TEXT NOT NULL,
  teacher_token TEXT,
  status TEXT NOT NULL DEFAULT 'bekliyor',
  location TEXT NOT NULL,
  category TEXT NOT NULL,
  description TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_faults_school ON faults(school_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_schools_codes ON schools(teacher_code, admin_code);

-- Sorumlunun makamlara sunacağı rapor için işlem kayıtları
CREATE TABLE IF NOT EXISTS logs (
  id TEXT PRIMARY KEY,
  school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  fault_id TEXT,
  actor_name TEXT,
  actor_role TEXT NOT NULL,
  action TEXT NOT NULL,
  detail TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_logs_school_time ON logs(school_id, created_at);
