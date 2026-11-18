CREATE TABLE IF NOT EXISTS transit_network (
 id INTEGER PRIMARY KEY CHECK(id=1), payload TEXT NOT NULL, imported_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS provider_usage (
 day TEXT NOT NULL, provider TEXT NOT NULL, calls INTEGER NOT NULL DEFAULT 0,
 PRIMARY KEY(day,provider)
);
