CREATE TABLE app_invitations (
  id TEXT PRIMARY KEY NOT NULL,
  actor_user_id TEXT NOT NULL REFERENCES app_users(id),
  email TEXT NOT NULL UNIQUE,
  user_id TEXT REFERENCES app_users(id),
  provider_username TEXT,
  state TEXT NOT NULL CHECK(state IN ('preparing','ready','sent','needs_attention')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE app_invitation_lock (id INTEGER PRIMARY KEY CHECK(id=1), touched_at TEXT NOT NULL);
INSERT INTO app_invitation_lock VALUES (1,'');
