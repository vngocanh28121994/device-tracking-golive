-- Custom SQL migration file, put your code below! --
WITH identities AS (
  SELECT display_name AS name, user_id FROM user_profiles
  UNION
  SELECT d.holder AS name, d.holder_user_id AS user_id
  FROM devices d
  JOIN user_profiles p ON p.user_id = d.holder_user_id
), unique_names AS (
  SELECT name, min(user_id) AS user_id
  FROM identities
  GROUP BY name
  HAVING count(DISTINCT user_id) = 1
)
UPDATE devices
SET holder_user_id = (SELECT user_id FROM unique_names WHERE name = devices.holder)
WHERE holder_user_id IS NULL
  AND holder IN (SELECT name FROM unique_names);
--> statement-breakpoint
UPDATE devices
SET holder = (SELECT display_name FROM user_profiles WHERE user_id = devices.holder_user_id)
WHERE holder_user_id IN (SELECT user_id FROM user_profiles);
