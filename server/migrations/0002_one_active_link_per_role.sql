-- At most one active link per tree and role (spec §4.1), also when two requests race.
CREATE UNIQUE INDEX share_link_active_role ON share_link(tree_id, role) WHERE revoked_at IS NULL;
