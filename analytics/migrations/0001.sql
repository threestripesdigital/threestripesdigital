CREATE TABLE meta_daily (
 day TEXT NOT NULL, ad_id TEXT NOT NULL, ad_name TEXT NOT NULL,
 adset_id TEXT NOT NULL, campaign_id TEXT NOT NULL, campaign_name TEXT NOT NULL,
 spend REAL NOT NULL CHECK(spend >= 0), impressions INTEGER NOT NULL CHECK(impressions >= 0),
 link_clicks INTEGER NOT NULL CHECK(link_clicks >= 0), PRIMARY KEY(day, ad_id)
);
CREATE INDEX meta_campaign_day ON meta_daily(campaign_id, day);
CREATE TABLE state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE locks (key TEXT PRIMARY KEY, owner TEXT NOT NULL, expires INTEGER NOT NULL);
CREATE TABLE sessions (id TEXT PRIMARY KEY, started_at TEXT NOT NULL, day TEXT NOT NULL, campaign_id TEXT NOT NULL, ad_id TEXT NOT NULL);
CREATE INDEX session_day ON sessions(day, campaign_id);
CREATE TABLE events (session_id TEXT NOT NULL REFERENCES sessions(id), kind TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(session_id,kind));
CREATE TABLE calls (
 id TEXT PRIMARY KEY, session_id TEXT REFERENCES sessions(id), booked_at TEXT NOT NULL, booked_day TEXT NOT NULL,
 scheduled_at TEXT NOT NULL, scheduled_day TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('scheduled','showed','no_show','cancelled')),
 qualified INTEGER CHECK(qualified IN (0,1)), boosted_at TEXT, paid_at TEXT,
 tier TEXT CHECK(tier IN ('rank_boost','premium')), monthly_retainer REAL CHECK(monthly_retainer >= 0), updated_at TEXT NOT NULL
);
CREATE INDEX call_booked ON calls(booked_day);
CREATE INDEX call_scheduled ON calls(scheduled_day);
CREATE TABLE revenue (id TEXT PRIMARY KEY, call_id TEXT NOT NULL REFERENCES calls(id), paid_at TEXT NOT NULL, day TEXT NOT NULL, amount REAL NOT NULL, currency TEXT NOT NULL);
CREATE INDEX revenue_day ON revenue(day);
ALTER TABLE sessions ADD COLUMN lead_ref TEXT;
CREATE INDEX session_lead ON sessions(lead_ref);
CREATE TABLE rate_limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires INTEGER NOT NULL);
