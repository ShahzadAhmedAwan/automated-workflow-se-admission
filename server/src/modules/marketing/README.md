# Marketing module boundary

Own marketing routes, controllers, services, and mocks here. Add `mkt_*` table definitions to the Marketing section of `server/database/schema.sql`. Use the shared outbox to publish `LEAD_QUALIFIED` and `WHATSAPP_MESSAGE` events. Protect staff routes with `authenticate` and `requirePermission('marketing.campaigns.manage')`. Do not import private Auth files; import only its public middleware surface from `src/modules/auth/index.js`.
