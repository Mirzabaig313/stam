-- Accounts, sessions, shared trees and their links (spec §4.1). Tokens are stored only as
-- SHA-256 hashes; a link token is also kept AES-GCM encrypted (LINK_KEY) so its owner can copy
-- the link again.

CREATE TABLE user (
  id TEXT PRIMARY KEY,
  google_sub TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL,
  name TEXT NOT NULL,
  avatar_url TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE session (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX session_user ON session(user_id);

CREATE TABLE tree (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES user(id),
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX tree_owner ON tree(owner_id);

CREATE TABLE share_link (
  id TEXT PRIMARY KEY,
  tree_id TEXT NOT NULL REFERENCES tree(id),
  role TEXT NOT NULL CHECK (role IN ('view', 'comment', 'edit')),
  hide_living INTEGER NOT NULL DEFAULT 0,
  token_hash TEXT NOT NULL UNIQUE,
  token_cipher TEXT NOT NULL,
  created_at TEXT NOT NULL,
  revoked_at TEXT
);
CREATE INDEX share_link_tree ON share_link(tree_id);
