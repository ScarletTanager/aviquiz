-- Staged route-service test schema, not an active production migration.
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
