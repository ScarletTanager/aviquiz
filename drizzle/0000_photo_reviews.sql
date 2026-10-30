CREATE TABLE photo_reviews (
  photo_id TEXT PRIMARY KEY NOT NULL,
  species_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  revision INTEGER NOT NULL DEFAULT 1,
  document_json TEXT NOT NULL,
  approved_json TEXT,
  updated_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX photo_reviews_species_idx ON photo_reviews (species_id);
