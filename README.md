# Pluto

A medical-book study chatbot with a **static Next.js/React frontend** and a separate **TypeScript Azure Functions API**, hosted on **Static Web Apps Free** and **Functions Flex Consumption**.

## Behavior

- **Book only (default):** hybrid keyword/vector retrieval, streamed book-grounded answers, and book-title citations.
- **Include web (opt-in):** website findings/citations appear first, followed by separate book findings/citations. Book passages are not sent to web search.
- Google sign-in, browser-local conversations, new chat, deletion/clear, and stop-response controls. No database or document uploader.

This educational PoC is not for diagnosis or prescribing. Sources can be incomplete, incorrect, or outdated. Do not enter identifiable patient information. The hosting refactor does not change the medical prompts, evidence limits, or model token budgets.

## Layout

| Location | Purpose |
| --- | --- |
| `src\app`, `src\components` | Static frontend |
| `src\lib\contract.ts` | Single shared request, event, and source contract |
| `api\src` | Functions entrypoint, HTTP boundary, retrieval, model integration, and instructions |
| `out` | Generated frontend deployment artifact |
| `api\dist` | Generated backend entrypoint, with the shared contract bundled |

The frontend calls the Function URL **directly**, not through Static Web Apps' integrated `/api` proxy. That proxy has a 45-second limit, shorter than a measured 56-second web-plus-books answer. Direct calls avoid that proxy, not the Functions platform's own HTTP limits.

## Local setup

Use **Node.js 24** and npm. Node 26 Functions support is Linux-only preview; do not use the system Node 26 for the Windows Functions host. `.nvmrc` records the required major version. Functions Core Tools v4 and the Azurite storage emulator are pinned, project-local backend development dependencies; global installations are unnecessary.

```powershell
npm ci
npm --prefix api ci
Copy-Item .env.example .env.local
Copy-Item api\.env.example api\.env
```

**Do not overwrite existing environment files.** When upgrading from the original application, move the ignored root `.env` to `api\.env` first; the frontend no longer needs those credentials.

Frontend build settings are `NEXT_PUBLIC_API_BASE_URL`, normally `http://localhost:7071` locally, and `NEXT_PUBLIC_GOOGLE_CLIENT_ID`, the public Google OAuth web client ID. Set the API URL to its HTTPS **origin** in production, without `/api`, query parameters, or credentials. Changing either setting requires rebuilding the static site.

Configure these server-only settings in `api\.env`:

| Variable | Purpose |
| --- | --- |
| `AZURE_OPENAI_ENDPOINT` | Azure OpenAI resource root URL |
| `AZURE_OPENAI_API_KEY` | Server-side model credential |
| `AZURE_OPENAI_CHAT_DEPLOYMENT` | Deployment name, currently `gpt-6-luna` |
| `AZURE_SEARCH_ENDPOINT` | Search service root URL |
| `AZURE_SEARCH_API_KEY` | Read-capable Search credential; prefer a runtime query key |
| `AZURE_SEARCH_INDEX` | Existing index, currently `rag-1795508603194` |
| `AZURE_SEARCH_API_VERSION` | Serverless-compatible version, currently `2026-08-01-preview` |
| `ENABLE_WEB_SEARCH` | Server capability switch; UI toggle still starts off |
| `CHAT_ENABLED` | Set `false` to pause chat |
| `GOOGLE_CLIENT_ID` | Google web client ID; must match the frontend's client ID |
| `ALLOWED_ORIGINS` | Comma-separated exact frontend origins, without trailing slashes |

The local API launcher defaults allowed origins to `http://localhost:3201,http://127.0.0.1:3201`. The production handler requires explicit configuration and verifies Google ID tokens before running chat. CORS is not authentication. Never expose a Function key or Azure resource key in frontend code. Add the frontend origins you use to the Google client's Authorized JavaScript origins.

The local launcher starts **Azurite on loopback ports 10010-10012** for Functions host storage, using an ephemeral local-only credential. This resolves the current Core Tools host's storage-health requirement without connecting to Azure Storage. The emulator data stays in ignored `api\.local-storage` (or `api\.test-host` during tests), and the launcher stops it with the API. Optional ingestion credentials retained in an existing environment file are not used by chat. Environment files, emulator data, and `api\local.settings.json` are ignored/excluded from packaging.

## Build and run

```powershell
npm run build
npm run build:api
npm start
```

Open **http://localhost:3201**. The Functions API is **http://localhost:7071**, with `GET /api/health` and `POST /api/chat`. `npm start` serves the exported frontend and starts the actual Core Tools host plus its local storage emulator. It checks port conflicts. Ctrl+C stops the preview. For separate terminals use `npm run start:frontend` and `npm run start:api`.

`npm run dev` starts the Next development frontend plus the same Functions host; build the API first. Backend changes require rebuilding/restarting the API. Browser history is tied to the frontend origin, so use the same localhost address to retain access to existing chats.

**Live questions are billable**, including when the UI/API run locally. Startup and the health check do not invoke Search or the model.

## Verification without Azure charges

```powershell
npm run lint
npm run typecheck
npm test
npm run build
npm run build:api
npm run test:artifacts
npm run test:host
npm run test:e2e
```

Install Chromium with `npx playwright install chromium` only if the browser runner reports it missing. Stop any manual API on port 7071 before host/browser tests.

The focused tests mock provider calls. Host integration tests use **real Core Tools v4** with a separate test-only entrypoint, synthetic answers, and blocked external provider fetches. Browser tests serve `out` on port 3100 and call the test Functions host on port 7071. They need no Azure credentials. Test fixtures never enter the production API build or deployment package; there is no production mock-mode switch.

The current stable Core Tools/Azurite development dependency trees report npm advisories (including Core Tools' archive-extraction dependency). These are development/build-only dependencies, Azurite binds to loopback, and production installation must omit development dependencies. Do not apply `npm audit fix --force` blindly: its suggested changes include preview Core Tools and an older major Azurite. Review supported tool updates separately from deployment setup.

Coverage includes input/body limits, exact-origin CORS/preflight, failure/paused states, real incremental HTTP streaming, stream cancellation/deadlines, book/web provenance, citations, history, and browser stop behavior. Local verification does not establish future Azure-hosted behavior.

The existing **billable** smoke commands remain available only for deliberate manual use: `npm run test:azure` and `npm run test:azure -- --web`. They are not part of automated verification.

## Streaming and cancellation limitation

The Functions v4 host streams answers incrementally. In local transport testing, **closing the browser stream did not immediately propagate cancellation back into the worker**. Stop halts display and marks the browser answer stopped, but backend/model work may continue and incur charges until it finishes or hits its deadline. Do not repeatedly stop/retry expecting free cancellation.

The backend still aborts work when its response stream is cancelled by the host, releases admission exactly once, and bounds the complete request to 190 seconds, retrieval to 45 seconds, and each model branch to 90 seconds. Real Azure disconnect behavior must be validated separately before public deployment. Reliable cross-instance explicit cancellation would need a separate design, not an in-memory endpoint pretending to work across scaled-out workers.

## Retrieval and PoC limits

The existing index needs retrievable `chunk_id`, `title`, and `chunk`, optional `parent_id`, and `text_vector` with a working text vectorizer. The backend performs one hybrid query using that vectorizer; no duplicate query embedding is generated by the app. It does not modify index permissions or use elevated-read bypasses.

The original corpus had 32,862 chunks, but two PDFs exceeded the extraction size limit and sampled Fitzpatrick text was garbled. Obvious corruption and empty evidence are rejected; this is not full OCR or medical quality assurance. Missing book evidence does not trigger a general-knowledge fallback. Extraction repair is deferred.

Web search uses a separate bounded Responses call only when requested. It requires a completed search with provider-supplied URL citations, sends only user-authored context, and can process queries outside the Azure compliance boundary. Failed sections remain visibly unverified.

- Four active requests and eight accepted requests/minute **per worker's shared demo bucket**. Forwarded-IP headers are not trusted. Limits reset on restart and are not distributed or a hard spending cap.
- Questions: 2,000 characters; retrieval: 15 candidates, up to five readable passages and 16,000 evidence characters. Existing output budgets include reasoning tokens.
- Up to 30 browser-local conversations and 100 messages/chat. Clearing site data removes history. Browser-only persistence is not a promise of zero provider-side processing/retention.
- No automatic generation retries, durable server-side history, uploads, or agent framework.

## GitHub Actions deployment

`.github\workflows\deploy-production.yml` is a **deployment-only** workflow. It runs when `main` changes, or through **Actions > Deploy production > Run workflow** with `main` selected. It does not run lint, unit, browser, host, or billable model/Search tests, and does not make CI a merge requirement. Perform correctness checks yourself before approving publication.

The workflow builds with Node 24 on Ubuntu, creates the static export and an independent API ZIP with Linux-installed production dependencies, and retains the release artifact for 14 days. Normal compiler/build failures still stop the release. It never packages `.env`, local settings, test fixtures, development tools, or the root Next.js server into the API.

The **Publish production** job waits for approval through the GitHub `production` environment. Publication is restricted to `main`; an older release fails explicitly if `main` changed while it was waiting. Deployments are serialized and are not cancelled by a newer push. Azure authentication uses short-lived OIDC tokens, not a stored Azure password or client secret.

### Configuration

Set these **repository Actions variables** under **Settings > Secrets and variables > Actions > Variables**:

| Variable | Value |
| --- | --- |
| `NEXT_PUBLIC_API_BASE_URL` | Production Function App HTTPS origin |
| `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | Public Google web client ID, matching the API setting |
| `PLUTO_FRONTEND_URL` | Production Static Web App HTTPS origin |

Set these variables on the **production environment** under **Settings > Environments > production**:

| Variable | Value |
| --- | --- |
| `AZURE_CLIENT_ID` | Deployment application's client ID |
| `AZURE_TENANT_ID` | Deployment application's tenant ID |
| `AZURE_SUBSCRIPTION_ID` | Subscription containing the hosting resources |
| `AZURE_RESOURCE_GROUP` | `Pluto` |
| `AZURE_FUNCTION_APP_NAME` | `pluto-backend-fnc-app` |
| `AZURE_STATIC_WEB_APP_NAME` | `pluto-frontend-web-app` |

Configure `production` with the owner as a required reviewer and only the `main` branch permitted. Self-approval must remain allowed if the owner also triggers the release.

The `pluto-github-actions` Entra application/service principal has an OIDC federated credential for this repository's **production environment**. Use the repository's actual subject prefix from the GitHub OIDC settings, followed by `:environment:production`: this repository uses immutable owner/repository IDs, not the older name-only prefix. The issuer is `https://token.actions.githubusercontent.com` and the audience is `api://AzureADTokenExchange`.

The identity has **Website Contributor** only on the Function App and **Contributor** only on the Static Web App, not on the whole resource group or subscription. Static publication retrieves a deployment token at runtime, masks it and removes it from the process afterward. Azure OpenAI/Search credentials stay in Function App settings and are not GitHub workflow secrets.

### Publishing and manual validation

Merge the deployment workflow into `main`, let **Build release** finish, then use **Review deployments** to approve **Publish production** after your checks. The same release artifact is published to both hosts. The workflow changes application files only: it preserves existing Function App settings, including `CHAT_ENABLED`, provider keys, Google configuration, storage identity, CORS and scale settings.

The backend and frontend publish sequentially, not atomically. If the frontend step fails after the backend succeeds, the job reports failure but does not automatically roll back either host. Inspect the failed step and rerun the latest `main` release when ready. For a code rollback, revert the change on `main` and approve the resulting release.

After publishing, manually verify Google sign-in, a medical question, streaming, citations and any changed feature. The existing public frontend is https://icy-bay-09003b400.8.azurestaticapps.net and the API is https://pluto-backend-fnc-app.azurewebsites.net.

No hosting resources are provisioned by this workflow. Static Web Apps Free does not eliminate backend execution, storage, bandwidth, model, web-search or Search costs. Credential rotation, book-storage permissions and distributed usage controls remain separate work.

## License

MIT; see [LICENSE](LICENSE).
