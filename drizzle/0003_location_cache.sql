CREATE TABLE location_metadata_cache (
 cache_key TEXT PRIMARY KEY NOT NULL,
 body_json TEXT NOT NULL,
 fetched_at TEXT NOT NULL
);
