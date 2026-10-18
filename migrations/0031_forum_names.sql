-- The developer forum's tables and columns take the names the forum API uses (docs/NAMING.md):
-- feedback items are forum topics, every stored time is <event>_at_ms, yes/no columns read like
-- booleans and numbers say what they count. The first feedback calls are gone, so a screenshot they
-- attached becomes one of its post's images, and each image row says where its file is kept.

-- Indexes are made again below under the new names.
DROP INDEX feedback_account;
DROP INDEX feedback_group;
DROP INDEX feedback_open;
DROP INDEX feedback_shown;
DROP INDEX feedback_shown_area;
DROP INDEX feedback_shown_votes;
DROP INDEX feedback_posts_item;
DROP INDEX feedback_posts_account;
DROP INDEX feedback_posts_check;
DROP INDEX feedback_tags_tag;
DROP INDEX feedback_votes_account;
DROP INDEX feedback_follows_account;
DROP INDEX feedback_helpful_account;
DROP INDEX feedback_media_unmatched;
DROP INDEX feedback_media_post;
DROP INDEX feedback_media_account;
DROP INDEX feedback_mentions_account;

ALTER TABLE feedback RENAME TO forum_topics;
-- new, a known issue's phase, or answered (TOPIC_STATUSES in packages/core/src/forum.ts).
ALTER TABLE forum_topics RENAME COLUMN status TO topic_status;
-- The known issue a private message was merged into.
ALTER TABLE forum_topics RENAME COLUMN group_id TO merged_into_topic_id;
-- One of FORUM_CATEGORIES, in a section of the forum (FORUM_SECTIONS).
ALTER TABLE forum_topics RENAME COLUMN area TO category;
ALTER TABLE forum_topics RENAME COLUMN known_title TO known_issue_title;
ALTER TABLE forum_topics RENAME COLUMN roadmap TO roadmap_item;
ALTER TABLE forum_topics RENAME COLUMN created_at TO created_at_ms;
ALTER TABLE forum_topics RENAME COLUMN updated_at TO updated_at_ms;
ALTER TABLE forum_topics RENAME COLUMN news_at TO news_at_ms;
ALTER TABLE forum_topics RENAME COLUMN seen_at TO seen_at_ms;
ALTER TABLE forum_topics RENAME COLUMN triaged_at TO triaged_at_ms;
ALTER TABLE forum_topics RENAME COLUMN triage_tries TO triage_attempt_count;
ALTER TABLE forum_topics RENAME COLUMN public TO is_public;
ALTER TABLE forum_topics RENAME COLUMN shown TO is_shown;
ALTER TABLE forum_topics RENAME COLUMN votes TO vote_count;
ALTER TABLE forum_topics RENAME COLUMN replies TO reply_count;
ALTER TABLE forum_topics RENAME COLUMN answer_post TO answer_post_id;
ALTER TABLE forum_topics RENAME COLUMN active_at TO last_activity_at_ms;
-- urgent, high, normal or low, in words instead of 1 to 4.
ALTER TABLE forum_topics RENAME COLUMN severity TO severity_rank;
ALTER TABLE forum_topics ADD COLUMN severity TEXT NOT NULL DEFAULT 'normal';
UPDATE forum_topics SET severity = CASE severity_rank WHEN 1 THEN 'urgent' WHEN 2 THEN 'high' WHEN 4 THEN 'low' ELSE 'normal' END;
ALTER TABLE forum_topics DROP COLUMN severity_rank;
-- What AI sorting found (TopicTriage): its keys in whole words too.
UPDATE forum_topics SET triage = json_object(
    'is_by_ai', json(CASE WHEN json_extract(triage, '$.ai') THEN 'true' ELSE 'false' END),
    'summary', json_extract(triage, '$.summary'),
    'why', json_extract(triage, '$.why'),
    'merged_into_topic_id', json_extract(triage, '$.merged_into'),
    'same_as_topic_id', json_extract(triage, '$.same_as'),
    'known_issue_draft', CASE WHEN json_type(triage, '$.draft') = 'object' THEN json(json_extract(triage, '$.draft')) END
  )
  WHERE triage IS NOT NULL;

ALTER TABLE feedback_posts RENAME TO forum_posts;
ALTER TABLE forum_posts RENAME COLUMN feedback_id TO topic_id;
-- developer (the developer wrote it), ai (their AI assistant) or zaisma.
ALTER TABLE forum_posts RENAME COLUMN author TO author_kind;
UPDATE forum_posts SET author_kind = 'developer' WHERE author_kind = 'person';
ALTER TABLE forum_posts RENAME COLUMN via TO posted_via;
ALTER TABLE forum_posts RENAME COLUMN text TO text_markdown;
-- What an AI attached for whoever fixes it, as JSON: { call, error_code, error_message, request_json, notes }.
-- What was attached before keeps its words, in notes.
ALTER TABLE forum_posts RENAME COLUMN context TO debug_context;
UPDATE forum_posts SET debug_context = json_object('call', NULL, 'error_code', NULL, 'error_message', NULL, 'request_json', NULL, 'notes', debug_context)
  WHERE debug_context IS NOT NULL;
ALTER TABLE forum_posts RENAME COLUMN created_at TO created_at_ms;
ALTER TABLE forum_posts RENAME COLUMN reply_to TO reply_to_post_id;
-- On a public topic: pending, passed (others see it) or held (waits for a person). NULL on a private one.
ALTER TABLE forum_posts RENAME COLUMN check_state TO check_status;
UPDATE forum_posts SET check_status = 'passed' WHERE check_status = 'ok';
ALTER TABLE forum_posts RENAME COLUMN check_tries TO check_attempt_count;
ALTER TABLE forum_posts RENAME COLUMN check_reason TO held_reason;
ALTER TABLE forum_posts RENAME COLUMN helpful TO helpful_count;

ALTER TABLE feedback_media RENAME TO forum_media;
ALTER TABLE forum_media RENAME COLUMN type TO content_type;
ALTER TABLE forum_media RENAME COLUMN ord TO position_index;
ALTER TABLE forum_media RENAME COLUMN created_at TO created_at_ms;
ALTER TABLE forum_media RENAME COLUMN matched TO has_passed_matching;
-- Where the file is kept in the games bucket.
ALTER TABLE forum_media ADD COLUMN storage_key TEXT NOT NULL DEFAULT '';
UPDATE forum_media SET storage_key = 'feedback-media/' || id;
-- A screenshot from the first feedback calls is its post's first image (matched on the next run).
INSERT INTO forum_media (id, post_id, account_id, content_type, position_index, created_at_ms, has_passed_matching, storage_key)
  SELECT id, id, account_id, picture, 0, created_at_ms, 0, 'feedback-pictures/' || id FROM forum_posts WHERE picture IS NOT NULL;
ALTER TABLE forum_posts DROP COLUMN picture;

ALTER TABLE feedback_tags RENAME TO forum_topic_tags;
ALTER TABLE forum_topic_tags RENAME COLUMN feedback_id TO topic_id;

ALTER TABLE feedback_votes RENAME TO forum_votes;
ALTER TABLE forum_votes RENAME COLUMN feedback_id TO topic_id;
ALTER TABLE forum_votes RENAME COLUMN created_at TO created_at_ms;

ALTER TABLE feedback_misplaced RENAME TO forum_misplaced_flags;
ALTER TABLE forum_misplaced_flags RENAME COLUMN feedback_id TO topic_id;
ALTER TABLE forum_misplaced_flags RENAME COLUMN created_at TO created_at_ms;

ALTER TABLE feedback_follows RENAME TO forum_follows;
ALTER TABLE forum_follows RENAME COLUMN feedback_id TO topic_id;
ALTER TABLE forum_follows RENAME COLUMN seen_at TO seen_at_ms;

ALTER TABLE feedback_helpful RENAME TO forum_helpful_marks;
ALTER TABLE forum_helpful_marks RENAME COLUMN created_at TO created_at_ms;

ALTER TABLE feedback_mentions RENAME TO forum_mentions;

ALTER TABLE forum_reports RENAME COLUMN created_at TO created_at_ms;

CREATE INDEX forum_topics_account ON forum_topics(account_id, updated_at_ms);
CREATE INDEX forum_topics_merged ON forum_topics(merged_into_topic_id);
CREATE INDEX forum_topics_open ON forum_topics(topic_status, created_at_ms);
CREATE INDEX forum_topics_shown ON forum_topics(is_shown, merged_into_topic_id, last_activity_at_ms);
CREATE INDEX forum_topics_shown_category ON forum_topics(is_shown, category, last_activity_at_ms);
CREATE INDEX forum_topics_shown_votes ON forum_topics(is_shown, vote_count);
CREATE INDEX forum_posts_topic ON forum_posts(topic_id, created_at_ms);
CREATE INDEX forum_posts_account ON forum_posts(account_id, created_at_ms);
CREATE INDEX forum_posts_check ON forum_posts(check_status, created_at_ms);
CREATE INDEX forum_topic_tags_tag ON forum_topic_tags(tag, topic_id);
CREATE INDEX forum_votes_account ON forum_votes(account_id);
CREATE INDEX forum_follows_account ON forum_follows(account_id);
CREATE INDEX forum_helpful_marks_account ON forum_helpful_marks(account_id);
CREATE INDEX forum_media_unmatched ON forum_media(has_passed_matching, created_at_ms);
CREATE INDEX forum_media_post ON forum_media(post_id, position_index);
CREATE INDEX forum_media_account ON forum_media(account_id, created_at_ms);
CREATE INDEX forum_mentions_account ON forum_mentions(account_id);
