-- Full-text search over the developer forum (apps/site/src/forum-search.ts), so developers and their
-- AI find answers fast. One row per topic (its title, and a known issue's workaround and roadmap
-- item) and one per post others can see. Ranked by relevance (bm25), titles weighing most. Words
-- match by their stem ("disconnects" finds "disconnected"), and codes like too_big stay whole.
CREATE VIRTUAL TABLE forum_search USING fts5(
  title,
  body,
  topic_id UNINDEXED,
  -- '' for the topic's own row.
  post_id UNINDEXED,
  tokenize = "porter unicode61 tokenchars '_'"
);

INSERT INTO forum_search (title, body, topic_id, post_id)
  SELECT COALESCE(known_title, title), TRIM(COALESCE(workaround, '') || ' ' || COALESCE(roadmap, '')), id, '' FROM feedback WHERE shown = 1;
INSERT INTO forum_search (title, body, topic_id, post_id)
  SELECT '', p.text, p.feedback_id, p.id FROM feedback_posts p JOIN feedback f ON f.id = p.feedback_id
  WHERE f.shown = 1 AND p.check_state = 'ok' AND NOT (p.kind = 'status' AND LENGTH(p.text) <= 60);
