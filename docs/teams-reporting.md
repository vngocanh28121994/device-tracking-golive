# Teams reporting

The Site owner configures a Microsoft Teams Workflows webhook in **Tài khoản của tôi**.
The URL is encrypted in D1 with the hosted `TEAMS_CONFIG_KEY` and is never returned to the browser.
Keep the key unchanged while a saved webhook exists. `SITE_OWNER_EMAIL` identifies the owner using the platform-verified email header.

The Site MCP tools are owner-only:

- `get_teams_reporting_status`: read configuration flags and latest delivery without exposing the webhook.
- `send_daily_teams_report`: send today's report after 19:05 Asia/Ho_Chi_Minh, if enabled and configured. Reports include total, checked, and pending devices with their current holders. Reports also announce when all devices are checked.

The daily cloud task calls the second tool once. The database claims `daily:YYYY-MM-DD` before sending, preventing concurrent or repeated deliveries. Do not retry an ambiguous delivery; inspect Teams and Workflow run history. Manual tests use separate request IDs and are labeled as tests.

`TEAMS_SCHEDULE_READY=1` records that the linked schedule is saved and enabled. It does not prove a delivery ran. The schedule must retain the Site link and owner identity; service access without visitor identity cannot invoke owner-only tools.

No real Teams webhook is included in source or test fixtures.
