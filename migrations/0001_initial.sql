CREATE TABLE IF NOT EXISTS leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  domain TEXT NOT NULL DEFAULT '',
  qualified INTEGER NOT NULL DEFAULT 0,
  total_boost_fits INTEGER NOT NULL DEFAULT 0,
  top_keywords TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT '',
  ip TEXT NOT NULL DEFAULT '',
  ip_country TEXT NOT NULL DEFAULT '',
  user_agent TEXT NOT NULL DEFAULT '',
  page_url TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_leads_ip_created_at
  ON leads (ip, created_at);
CREATE INDEX IF NOT EXISTS idx_leads_email_created_at
  ON leads (email, created_at);
