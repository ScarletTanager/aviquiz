-- PostgreSQL active application schema. IDs, JSON and times remain text for cross-provider compatibility.
CREATE TABLE photo_reviews (
  photo_id TEXT PRIMARY KEY NOT NULL,
  species_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  revision INTEGER NOT NULL DEFAULT 1,
  document_json TEXT NOT NULL,
  approved_json TEXT,
  updated_at TEXT NOT NULL
);

CREATE INDEX photo_reviews_species_idx ON photo_reviews (species_id);

CREATE TABLE app_users (
  id TEXT PRIMARY KEY NOT NULL,
  email TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','disabled')),
  created_at TEXT NOT NULL
);

CREATE TABLE app_identities (
  issuer TEXT NOT NULL,
  subject TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  PRIMARY KEY(issuer,subject)
);

CREATE INDEX app_identities_user_idx ON app_identities(user_id);

CREATE TABLE app_grants (
  user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  permission TEXT NOT NULL CHECK(permission IN ('system.admin','users.invite','experiment.id-tips','annotations.read','annotations.edit','annotations.publish')),
  PRIMARY KEY(user_id,permission)
);

CREATE TABLE audit_events (
  id TEXT PRIMARY KEY NOT NULL,
  actor_user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL CHECK(resource_type IN ('user','grant','route','route-member')),
  resource_id TEXT NOT NULL,
  details_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE app_bootstrap (
  id INTEGER PRIMARY KEY CHECK(id=1),
  user_id TEXT NOT NULL REFERENCES app_users(id),
  attempt TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);


-- SQL-only audit immutability; database administrators remain trusted.
CREATE FUNCTION reject_audit_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Audit events cannot be updated or deleted'; END;
$$;
CREATE TRIGGER audit_events_no_mutation BEFORE UPDATE OR DELETE ON audit_events
FOR EACH ROW EXECUTE FUNCTION reject_audit_mutation();

CREATE TRIGGER audit_events_no_truncate BEFORE TRUNCATE ON audit_events
FOR EACH STATEMENT EXECUTE FUNCTION reject_audit_mutation();
