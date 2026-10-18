-- Blocks (docs/DECISIONS.md, "Players can mute, block and report other players" and "How blocks
-- work"): a block one account made of another, kept until it's undone on the friends page. It's a wall
-- both ways, in every game. Deleted with either account.
CREATE TABLE blocks (
  account_id TEXT NOT NULL,
  blocked_account_id TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL,
  PRIMARY KEY (account_id, blocked_account_id)
);
CREATE INDEX blocks_blocked_account ON blocks(blocked_account_id);
