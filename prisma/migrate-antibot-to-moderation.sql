BEGIN;

-- Bron: elke guild met een ingeschakelde anti-bot configuratie.
WITH src AS (
  SELECT
    ab.guild_id,
    ab.time_window,
    ab.channel_limit,
    ab.message_limit,
    ab.mention_limit,
    ab.min_account_age_days,
    ab.raid_threshold,
    ab.block_invites,
    ab.block_nsfw_invites,
    ab.block_zalgo,
    ab.block_duplicates,
    ab.csam_protection,
    ab.notification_channel,
    ab.jail_role,
    ab.delete_messages_days,
    -- "jail" bestaat niet in Moderation; een rol uitdelen is daar de mute.
    CASE ab.punishment
      WHEN 'jail' THEN 'mute'
      WHEN 'mute' THEN 'mute'
      WHEN 'kick' THEN 'kick'
      WHEN 'ban'  THEN 'ban'
      ELSE 'none'
    END AS action,
    CASE ab.new_account_action
      WHEN 'jail' THEN 'mute'
      WHEN 'kick' THEN 'kick'
      WHEN 'ban'  THEN 'ban'
      ELSE 'none'
    END AS account_action,
    -- Json-arrays naar text[], lege rijen eruit
    COALESCE((
      SELECT array_agg(v) FROM jsonb_array_elements_text(ab.forbidden_words) AS v
      WHERE jsonb_typeof(ab.forbidden_words) = 'array' AND btrim(v) <> ''
    ), '{}') AS words,
    COALESCE((
      SELECT array_agg(v) FROM jsonb_array_elements_text(ab.forbidden_usernames) AS v
      WHERE jsonb_typeof(ab.forbidden_usernames) = 'array' AND btrim(v) <> ''
    ), '{}') AS usernames,
    COALESCE(ARRAY(
      SELECT p FROM unnest(ab.forbidden_patterns) AS p WHERE btrim(p) <> ''
    ), '{}') AS patterns
  FROM anti_bot_settings ab
  WHERE ab.enabled
)

-- 1. Een moderation_settings rij is verplicht: moderation_filters hangt eraan vast.
INSERT INTO moderation_settings (
  guild_id, enabled, log_channel, mute_role, delete_message_days, updated_at
)
SELECT
  s.guild_id,
  true,
  s.notification_channel,
  s.jail_role,
  LEAST(7, GREATEST(0, s.delete_messages_days)),
  now()
FROM src s
ON CONFLICT (guild_id) DO NOTHING;

-- 2. De filters zelf. ON CONFLICT DO NOTHING, zodat een filter dat al in het
--    nieuwe dashboard is ingesteld nooit wordt overschreven.
WITH src AS (
  SELECT
    ab.guild_id,
    ab.time_window,
    ab.channel_limit,
    ab.message_limit,
    ab.mention_limit,
    ab.min_account_age_days,
    ab.raid_threshold,
    ab.block_invites,
    ab.block_nsfw_invites,
    ab.block_zalgo,
    ab.block_duplicates,
    ab.csam_protection,
    CASE ab.punishment
      WHEN 'jail' THEN 'mute'
      WHEN 'mute' THEN 'mute'
      WHEN 'kick' THEN 'kick'
      WHEN 'ban'  THEN 'ban'
      ELSE 'none'
    END AS action,
    CASE ab.new_account_action
      WHEN 'jail' THEN 'mute'
      WHEN 'kick' THEN 'kick'
      WHEN 'ban'  THEN 'ban'
      ELSE 'none'
    END AS account_action,
    COALESCE((
      SELECT array_agg(v) FROM jsonb_array_elements_text(ab.forbidden_words) AS v
      WHERE jsonb_typeof(ab.forbidden_words) = 'array' AND btrim(v) <> ''
    ), '{}') AS words,
    COALESCE((
      SELECT array_agg(v) FROM jsonb_array_elements_text(ab.forbidden_usernames) AS v
      WHERE jsonb_typeof(ab.forbidden_usernames) = 'array' AND btrim(v) <> ''
    ), '{}') AS usernames,
    COALESCE(ARRAY(
      SELECT p FROM unnest(ab.forbidden_patterns) AS p WHERE btrim(p) <> ''
    ), '{}') AS patterns
  FROM anti_bot_settings ab
  WHERE ab.enabled
),
rows AS (
  --      type          | aan?                        | delete | alert | entries      | limit | window | threshold | action
  SELECT s.guild_id, 'words'::text AS type, cardinality(s.words) > 0 AS on, true AS del, s.words AS entries,
         5 AS lim, 10 AS win, 3 AS thr, s.action AS act FROM src s
  UNION ALL
  SELECT s.guild_id, 'patterns', cardinality(s.patterns) > 0, true, s.patterns, 5, 10, 1, s.action FROM src s
  UNION ALL
  SELECT s.guild_id, 'usernames', cardinality(s.usernames) > 0, false, s.usernames, 5, 10, 1, s.action FROM src s
  UNION ALL
  SELECT s.guild_id, 'invites', s.block_invites, true, '{}', 5, 10, 3, s.action FROM src s
  UNION ALL
  SELECT s.guild_id, 'nsfwInvites', s.block_nsfw_invites, true, '{}', 5, 10, 1, s.action FROM src s
  UNION ALL
  SELECT s.guild_id, 'zalgo', s.block_zalgo, true, '{}', 5, 10, 3, s.action FROM src s
  UNION ALL
  SELECT s.guild_id, 'csam', s.csam_protection, true, '{}', 5, 10, 1, s.action FROM src s
  UNION ALL
  SELECT s.guild_id, 'duplicates', s.block_duplicates, true, '{}', 3, GREATEST(1, s.time_window), 3, s.action FROM src s
  UNION ALL
  SELECT s.guild_id, 'mentions', s.mention_limit > 0, true, '{}', GREATEST(1, s.mention_limit), 10, 3, s.action FROM src s
  UNION ALL
  SELECT s.guild_id, 'spam', s.message_limit > 0, true, '{}', GREATEST(1, s.message_limit), GREATEST(1, s.time_window), 3, s.action FROM src s
  UNION ALL
  SELECT s.guild_id, 'channelSpam', s.channel_limit > 0, true, '{}', GREATEST(1, s.channel_limit), GREATEST(1, s.time_window), 3, s.action FROM src s
  UNION ALL
  SELECT s.guild_id, 'accountAge', s.min_account_age_days > 0, false, '{}', GREATEST(1, s.min_account_age_days), 10, 1, s.account_action FROM src s
  UNION ALL
  SELECT s.guild_id, 'raid', s.raid_threshold > 0, false, '{}', GREATEST(1, s.raid_threshold), 10, 1, s.action FROM src s
)
INSERT INTO moderation_filters (
  guild_id, type, enabled, alert, log, "delete",
  hard_action, hard_action_duration, threshold_maximum, threshold_duration,
  "limit", "window", minimum_length, entries, entries_mode,
  ignored_channels, ignored_roles, updated_at
)
SELECT
  r.guild_id, r.type, r.on, false, true, r.del,
  r.act, 0, r.thr, 60,
  r.lim, r.win, 10, r.entries, 'blacklist',
  '{}', '{}', now()
FROM rows r
WHERE r.on
ON CONFLICT (guild_id, type) DO NOTHING;

COMMIT;
