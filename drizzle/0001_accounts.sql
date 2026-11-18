CREATE TABLE app_users (
  id TEXT PRIMARY KEY NOT NULL,
  email TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','disabled')),
  created_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE app_identities (
  issuer TEXT NOT NULL,
  subject TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  PRIMARY KEY(issuer,subject)
);
--> statement-breakpoint
CREATE INDEX app_identities_user_idx ON app_identities(user_id);
--> statement-breakpoint
CREATE TABLE app_grants (
  user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  permission TEXT NOT NULL CHECK(permission IN ('system.admin','users.invite','experiment.id-tips','annotations.read','annotations.edit','annotations.publish')),
  PRIMARY KEY(user_id,permission)
);
--> statement-breakpoint
CREATE TABLE audit_events (
  id TEXT PRIMARY KEY NOT NULL,
  actor_user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL CHECK(resource_type IN ('user','grant','route','route-member')),
  resource_id TEXT NOT NULL,
  details_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
--> statement-breakpoint
-- Append-only through application SQL; provider database admins remain trusted.
CREATE TRIGGER audit_events_no_update BEFORE UPDATE ON audit_events
BEGIN SELECT RAISE(ABORT,'Audit events cannot be updated'); END;
--> statement-breakpoint
CREATE TRIGGER audit_events_no_delete BEFORE DELETE ON audit_events
BEGIN SELECT RAISE(ABORT,'Audit events cannot be deleted'); END;
--> statement-breakpoint

CREATE TABLE app_bootstrap (
  id INTEGER PRIMARY KEY CHECK(id=1),
  user_id TEXT NOT NULL REFERENCES app_users(id),
  attempt TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);
--> statement-breakpoint
