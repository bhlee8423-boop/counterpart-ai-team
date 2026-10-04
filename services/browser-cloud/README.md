# Counterpart Browser Cloud dedicated service

This deploys the existing browser and MCP implementation from this repository.
The two API entry points re-export the shared handlers; the UI build copies the
existing `browser.html`. The parent Counterpart production project is unchanged.

- Source branch: `feature/counterpart-browser-cloud-v1` (draft PR #2).
- Dedicated Vercel project: `counterpart-browser-cloud`.
- Project ID: `prj_W6UoNfPuV49vk0ywIw1hJXuCbIJL`.
- Team ID: `team_JBhh20YbU2qp216ybajRRCOM`.
- Root directory: `services/browser-cloud`.
- Install command: `npm --prefix ../.. ci --ignore-scripts --no-audit --no-fund`.
- Build command: `npm run build`.
- Enable files outside the root directory for shared handlers/dependencies.
- Production service enablement uses explicit, non-secret dedicated identifiers
  in `vercel.json`. Automatic system-environment exposure is unnecessary.
- Deployment protection protects previews and unique production deployment URLs;
  the dedicated production alias is intended to be public.

The project was initially created from `main`, which has no service directory.
That initial deployment failed with `NOW_SANDBOX_WORKER_ROOTDIR_NOT_EXIST`.
Push this feature branch, verify its preview, and promote that dedicated preview.
Do not merge PR #2 or promote a deployment of the parent Counterpart project.

Run `node --test tests/browser-cloud*.test.js` at the repository root. The tests
exercise URL/DNS/IPv6 guards, the validated-IP proxy, action/form restrictions,
production isolation, run quotas, one-click stop behavior, actual MCP transport,
and simulated planner exhaustion. Browser state-machine tests use a Chromium
fixture; they do not replace real Chromium QA on the final public deployment.

Network connections use a local proxy that validates DNS and connects to the
chosen public IP. Private redirects/subresources and rebinding are denied.
Only GET/HEAD browser requests are permitted. Non-search forms and protected
actions stop before execution. The service has a seven-step, 45-second budget
and a local quota of 12 runs/hour with one concurrent run per warm instance.
That quota is not a durable global account budget. The free planner is LLM7's
temporary test API; no paid fallback is configured.

Final public QA, Hobby-plan confirmation, and ChatGPT plugin installation must
still be completed before declaring this service ready.
