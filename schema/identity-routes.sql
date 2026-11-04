-- Staged schema, NOT an active drizzle migration. Apply only in isolated tests now.
-- Promote through a new provider-reviewed migration when activating this subsystem.
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
  permission TEXT NOT NULL CHECK(permission IN ('system.admin','experiment.id-tips','annotations.read','annotations.edit','annotations.publish')),
  PRIMARY KEY(user_id,permission)
);
CREATE TABLE routes (
  id TEXT PRIMARY KEY NOT NULL,
  owner_user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  title TEXT NOT NULL CHECK(length(trim(title)) BETWEEN 1 AND 200),
  visibility TEXT NOT NULL DEFAULT 'private' CHECK(visibility IN ('private','public')),
  created_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX routes_owner_idx ON routes(owner_user_id);
CREATE TABLE route_members (
  route_id TEXT NOT NULL REFERENCES routes(id) ON DELETE RESTRICT,
  user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  role TEXT NOT NULL CHECK(role IN ('viewer','contributor','editor')),
  PRIMARY KEY(route_id,user_id)
);
CREATE INDEX route_members_user_idx ON route_members(user_id);
CREATE TABLE audit_events (
  id TEXT PRIMARY KEY NOT NULL,
  actor_user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL CHECK(resource_type IN ('user','grant','route','route-member')),
  resource_id TEXT NOT NULL,
  details_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
-- Append-only through application SQL; provider database admins remain trusted.
CREATE TRIGGER audit_events_no_update BEFORE UPDATE ON audit_events
BEGIN SELECT RAISE(ABORT,'Audit events cannot be updated'); END;
CREATE TRIGGER audit_events_no_delete BEFORE DELETE ON audit_events
BEGIN SELECT RAISE(ABORT,'Audit events cannot be deleted'); END;
