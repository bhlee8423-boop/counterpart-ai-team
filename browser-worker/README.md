# Counterpart Browser Cloud

Free-first cloud browser agent for the Counterpart AI Team.

## Safety / cost defaults

- Cloudflare Browser Run + Workers AI only.
- `BROWSER_FREE_TIER_CONFIRMED` defaults to `false`. The run endpoint refuses to launch a browser until the account is confirmed to be on the intended zero-cost tier.
- `COUNTERPART_BROWSER_KEY` is required as a Wrangler secret.
- Browser runs are bounded by `MAX_STEPS` and `MAX_RUN_MS`.
- The agent stops before purchases, payments, bookings, submissions, sending, publishing, deletion, account/security changes, legal acceptance, or sensitive credential/payment entry.

## Deploy

1. Confirm the Cloudflare account's Browser Run plan is appropriate for zero-cost use.
2. Set `BROWSER_FREE_TIER_CONFIRMED` to `true`.
3. Create the access secret:
   `npx wrangler secret put COUNTERPART_BROWSER_KEY`
4. Install and deploy:
   `npm install`
   `npm run deploy`

Expected endpoint:
`https://counterpart-browser-cloud.<workers-subdomain>.workers.dev/api/browser/run`

## Request

POST JSON:
```json
{
  "url": "https://example.com",
  "task": "Find the support email shown on this site",
  "maxSteps": 8
}
```

Header:
`X-Counterpart-Browser-Key: <secret>`

## Current v1 scope

This first cloud version is optimized for public web tasks. Persistent authenticated browser profiles are intentionally not included until encrypted session persistence is configured.
