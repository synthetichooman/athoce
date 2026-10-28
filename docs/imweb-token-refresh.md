# Imweb token renewal

Pages uses the `IMWEB_TOKEN_MANAGER` binding when configured. The binding points to
`ImwebTokenManager` in the separate Worker `athoce-imweb-token-manager`.
All Pages entry points (product requests, public retry, owner refresh, Telegram,
OAuth callback) use the same object named `athoce-imweb`.

The object serializes token reads, authorization writes, and refresh operations.
The durable token pair is authoritative; Pages never falls back to the older KV
pair when a configured manager is unavailable. On first use only, Pages seeds the
existing KV pair and client credentials through the internal binding. Neither the
Worker nor the object exposes a public token API.

The Worker cron runs every 15 minutes, and a Durable Object alarm provides an
independent check every 15 minutes (the initial alarm runs after one minute). A token older than one hour, or within ten
minutes of its reported expiry, is renewed. Concurrent renewals reuse the new
pair. An upstream timeout is limited to 15 seconds; failed renewals keep the old
pair and retry after five minutes. The upstream `expires_in` is retained after
initial authorization and renewal. Expired/revoked refresh tokens still require
Imweb authorization; neither a visitor nor a scheduler can bypass that.

## Deploy and initialize

1. Deploy `workers/imweb-token-manager/wrangler.jsonc` using Wrangler.
2. Bind the **same existing** `ATHOCE_KV` namespace to that Worker for its rollback
   mirror. The manager stays authoritative if this optional mirror fails.
3. Add a Pages production Durable Object binding:
   - variable: `IMWEB_TOKEN_MANAGER`
   - Worker: `athoce-imweb-token-manager`
   - class: `ImwebTokenManager`
4. Deploy the Pages code, then call `/api/products?cache=refresh` to initialize.
5. Check owner-only `/api/admin/imweb-health`: source must be `durable-object`,
   scheduler enabled, next check present. Check again after a scheduled run and
   confirm `lastScheduledCheckAt` advanced without visitor activity. Verify a product
   response is fresh (`stale` absent/false), not just a successful stale fallback.

Preview deployments should not bind the production object. Use a separately
named Worker for testing if preview needs live authorization. Otherwise previews
retain the legacy KV path. Do not copy production credentials into source files.

## Rollback

Before removing the Pages manager binding, confirm that its latest token pair
was mirrored to KV. Never roll back to static environment tokens or an old KV
snapshot after rotation. Keep the scheduler Worker disabled during rollback so
it cannot rotate independently of the legacy Pages path.

## Verification

`node --test tests/imweb-refresh.test.mjs`

`npx wrangler deploy --dry-run --config workers/imweb-token-manager/wrangler.jsonc`

`npx wrangler pages functions build functions --outdir tmp/imweb-pages-build`
