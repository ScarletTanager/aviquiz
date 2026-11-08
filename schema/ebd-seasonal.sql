-- Offline analytical schema. Not an AviQuiz Worker migration.
PRAGMA foreign_keys = ON;

CREATE TABLE ebd_release (
  release_id TEXT PRIMARY KEY,
  citation TEXT NOT NULL,
  taxonomy_version TEXT NOT NULL,
  -- Version of effort, deduplication, and geographic assignment rules.
  processing_version TEXT NOT NULL
);

-- A place definition is immutable once used; changes get a new ID.
CREATE TABLE ebd_place (
  place_id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('hotspot', 'region', 'cell')),
  source_key TEXT NOT NULL,
  definition_version TEXT NOT NULL,
  UNIQUE (kind, source_key, definition_version)
);

-- Keys are scoped to one taxonomic interpretation. Do not combine versions
-- across a split/lump until an explicit mapping or rebuild is available.
CREATE TABLE ebd_taxon (
  taxonomy_version TEXT NOT NULL,
  taxon_key TEXT NOT NULL,
  scientific_name TEXT NOT NULL,
  common_name TEXT NOT NULL,
  PRIMARY KEY (taxonomy_version, taxon_key)
);

-- Refresh a complete place/year in one transaction, even if now empty.
-- The FK cascade removes stale facts when a partition is replaced.
CREATE TABLE ebd_partition (
  place_id TEXT NOT NULL REFERENCES ebd_place,
  observation_year INTEGER NOT NULL CHECK (observation_year BETWEEN 1800 AND 9999),
  release_id TEXT NOT NULL REFERENCES ebd_release,
  PRIMARY KEY (place_id, observation_year)
);

-- Complete eligible checklists, deduplicated to one birding party/event.
-- No observer identifiers, comments or per-checklist coordinates.
CREATE TABLE ebd_effort_day (
  place_id TEXT NOT NULL,
  observation_year INTEGER NOT NULL,
  observation_date TEXT NOT NULL CHECK (
    date(observation_date, '+0 days') IS NOT NULL
    AND observation_date = date(observation_date, '+0 days')
    AND substr(observation_date, 1, 4) = printf('%04d', observation_year)
  ),
  checklist_count INTEGER NOT NULL CHECK (checklist_count > 0),
  PRIMARY KEY (place_id, observation_year, observation_date),
  FOREIGN KEY (place_id, observation_year) REFERENCES ebd_partition ON DELETE CASCADE
);

CREATE TABLE ebd_detection_day (
  place_id TEXT NOT NULL,
  observation_year INTEGER NOT NULL,
  observation_date TEXT NOT NULL,
  taxonomy_version TEXT NOT NULL,
  taxon_key TEXT NOT NULL,
  checklist_count INTEGER NOT NULL CHECK (checklist_count > 0),
  PRIMARY KEY (place_id, observation_year, observation_date, taxonomy_version, taxon_key),
  FOREIGN KEY (place_id, observation_year, observation_date) REFERENCES ebd_effort_day ON DELETE CASCADE,
  FOREIGN KEY (taxonomy_version, taxon_key) REFERENCES ebd_taxon
);

-- Run before committing a partition replacement. This view must return zero rows.
CREATE VIEW ebd_invalid_detection AS
SELECT d.* FROM ebd_detection_day d
JOIN ebd_effort_day e USING (place_id, observation_year, observation_date)
JOIN ebd_partition p USING (place_id, observation_year)
JOIN ebd_release r USING (release_id)
WHERE d.checklist_count > e.checklist_count OR d.taxonomy_version <> r.taxonomy_version;
