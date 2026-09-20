# Counterpart AI backend

Release candidate **1.2.0-rc.2**, prepared for Cloudflare Workers Builds on 2026-09-19.
This directory contains the existing tested candidate. It has not been verified on the live Cloudflare account.


## Connect the existing Worker

Open **counterpart-ai-backend → Settings → Builds → Connect → GitHub**.

| Cloudflare setting | Value |
| --- | --- |
| GitHub account | `bhlee8423-boop` |
| Repository | `counterpart-ai-team` |
| Branch | `codex/counterpart-backend-rc2` |
| Root directory | `backend` |
| Build command | `npm test && npm run build` |
| Deploy command | `npx wrangler versions upload` |
| Non-production branch deploy command, if enabled | `npx wrangler versions upload` |

The package pins the official Wrangler CLI to `4.135.0` and requires Node 22 or later.
Cloudflare installs dependencies before the build. Cloudflare's generated build token remains in Cloudflare; no token belongs in this repository.

`versions upload` creates a version for inspection without promoting it to the active deployment.
The Worker name in `wrangler.jsonc` matches the existing `counterpart-ai-backend` service.
The repository root `index.html` remains the current Vercel frontend.

## What a successful initial build means

The build runs the included backend regression and federation checks using mocked inference, then regenerates the standalone module.
Cloudflare validates and uploads that module using the configuration in this directory.
If Cloudflare preview URLs are enabled for this Worker, inspect the new version's preview URL in its deployment history.

With the supplied configuration, `/health` should report `version: "1.2.0-rc.2"` and `ready: false`.
`/api/capabilities` should show blocked model records; an existing `COUNTERPART_API_KEY` may require its normal request header.
AI calls are deliberately blocked because account eligibility has not yet been verified.

## Before activating the candidate

1. Inspect and preserve the current deployed Worker source, bindings, variables, secrets, and deployment identifier. Compare it with the supplied baseline; the baseline is a preserved local copy, not a verified export of the current deployment.
2. Verify the actual Workers Free plan, Workers AI binding, available models, and remaining quota. Do not enable purchases or paid overage.
3. Only after that verification, set `CF_FREE_TIER_CONFIRMED=true` in the version configuration and upload a new candidate. Keep `FEDERATION_ALLOW_PAID=false` and `FEDERATION_MAX_PAID_CALLS=0`.
4. Verify health/capabilities and one small real council plus cross-review on the candidate, including returned provenance and provider usage. Preserve any current settings that the candidate needs.
5. Activate the reviewed version and verify it at the existing service URL. Publish the matching frontend as a separate reviewed change after the backend is ready.

The GitHub connection supplies a code deployment route. It does not independently verify account billing, current backend state, or live model access.

## Local work

```sh
cd backend
npm test
npm run build
```

These checks and the standalone build require Node 22 or later but no installed packages or credentials.
Wrangler is required only for Cloudflare operations.
`worker.js` and `federation.js` are the editable source; `build.mjs` generates `counterpart-ai-backend-v1.2.0-rc.2.js`.
The preserved v1.1.2 backend is in `baseline/` for regression comparison.

The candidate keeps all 15 specialists, blind first passes, dissent and abstention, model/provider provenance, and bounded free-first routing.
Several model families on Cloudflare still count as one serving provider. External provider adapters are mocked in tests and require separately authorized account configuration.

References: [Cloudflare Builds](https://developers.cloudflare.com/workers/ci-cd/builds/), [build settings](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/), [Wrangler 4.135.0 release](https://github.com/cloudflare/workers-sdk/releases/tag/wrangler%404.135.0).
