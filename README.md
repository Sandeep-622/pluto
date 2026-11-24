# Pluto

A small medical-book study chatbot built with **Next.js, React, TypeScript, Azure AI Search, and Azure OpenAI**. One application hosts the UI and backend.

## What it does

- **Book only (default):** hybrid keyword/vector retrieval, streamed book-grounded answers, and book-title citations.
- **Include web (opt-in):** Luna uses the Responses `web_search` tool. Website findings/citations appear first, followed by the separate book section and book citations. Book passages are not sent to web search.
- Browser-local conversations, new chat, deletion/clear, and stop-response controls. No login, database, or document uploader.

This is a development/test PoC for education, not diagnosis, prescribing, or a production medical service. Do not enter identifiable patient information. Book editions and web pages may be incomplete, incorrect, or outdated; check the cited sources.

## Local setup

Use a supported **Node.js LTS (24 or 26)** and npm.

```powershell
npm ci
Copy-Item .env.example .env
```

If `.env` already exists, preserve it instead of copying over it. Fill its server-only settings:

| Variable | Purpose |
| --- | --- |
| `AZURE_OPENAI_ENDPOINT` | Azure resource root URL, not a deployment/completions URL |
| `AZURE_OPENAI_API_KEY` | Server-side Azure OpenAI key |
| `AZURE_OPENAI_CHAT_DEPLOYMENT` | Actual deployment name, currently `gpt-6-luna` |
| `AZURE_SEARCH_ENDPOINT` | Search service root URL |
| `AZURE_SEARCH_API_KEY` | Read-capable Search key; prefer a query key for runtime |
| `AZURE_SEARCH_INDEX` | Existing index, currently `rag-1795508603194` |
| `AZURE_SEARCH_API_VERSION` | Serverless-compatible version, currently `2026-08-01-preview` |
| `ENABLE_WEB_SEARCH` | Server capability switch; user's toggle still starts off |
| `CHAT_ENABLED` | Set `false` to pause the chat API |

Optional Storage settings are organized in the example for ingestion work. The chat app does **not** use or require the Storage key. Never prefix credentials with `NEXT_PUBLIC_`. `.env` is ignored, but you must also avoid manually adding it to Git or deployment archives.

```powershell
npm run dev
```

Open the localhost address printed by Next.js. The server alone calls Azure; there are no Azure keys in the browser API payload.

## Retrieval requirements

The existing index needs retrievable `chunk_id`, `title`, and `chunk` fields, optional `parent_id`, and a `text_vector` field with a working text vectorizer. The adapter sends one hybrid request and lets the index's configured embedding model vectorize the query. No additional embedding request is made by this app.

This anonymous shared-corpus PoC expects ordinary authorized server queries to return the intended corpus. If document-level permission filtering is enabled, configure the intended access explicitly; do not bypass it with elevated-read headers or expose admin credentials in the browser. The app does not change your index configuration.

The original ingestion had 32,862 chunks, but that is not proof of full coverage. Two PDFs exceeded the extraction size limit, and sampled Fitzpatrick text was garbled. The app rejects obvious private-use/replacement-glyph corruption and empty evidence; this is not full OCR quality assurance or a relevance guarantee. PDF repairs and re-ingestion are deferred. A chat answer with no supporting book citations is visibly flagged.

## Web mode

The existing model must support Responses API web search in the subscription. The backend attaches `web_search` only when explicitly requested and limits it to one tool call. It validates completed search output and uses provider-supplied URL citations. Web failure stays visible and does not prevent an independent book answer. If book evidence is missing, the book section says so rather than pretending web findings came from books.

Web search and model calls are billable. Web queries may be processed outside the Azure compliance boundary under Web IQ terms. Only user-authored search context is sent to the web branch, never retrieved book passages or generated book answers. Avoid sensitive information. Browser-only history does not mean requests avoid Azure or imply zero provider-side retention.

## Verification

```powershell
npm run lint
npm run typecheck
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

Browser tests start the production build on port 3100 and mock chat responses: no model charges. They require a configured local `.env` to start the server. Focused tests cover request validation, corruption rejection, provenance, default-off web, partial errors, stream decoding, and browser persistence.

Optional **billable** smoke checks of the actual Search/model resources:

```powershell
npm run test:azure
npm run test:azure -- --web
```

The first tests hybrid retrieval; the second adds one real web-search model call. Output contains status/counts/source names, not credentials or full book passages.

For a local production run (loads the ignored local settings explicitly):

```powershell
$env:PORT = '3000'
$env:HOSTNAME = '127.0.0.1'
node --env-file=.env .next\standalone\server.js
```

## Azure App Service deployment

Use one Linux App Service with a supported Node LTS runtime matching the build, HTTPS, and one instance for this PoC. Provisioning a paid plan requires a cost decision; Visual Studio monthly credits are for development/testing, not production hosting.

1. Rotate any credentials shared in chat before public hosting. Update dependent Search vectorizer/skillset connections as part of the same change; rotating only the OpenAI key can break retrieval. Keep source blobs private if public downloads are not intended.
2. Run `npm ci` and `npm run build`. The build creates `.next\standalone` including static assets, removes environment files copied by Next.js, and verifies they are absent.
3. Configure the required variables above in **App Service > Settings > Environment variables**. Do not upload `.env`. The Storage key is not needed by the hosted app.
4. Deploy **the contents** of `.next\standalone` as the ZIP root, not the repository. Use a Linux build for Linux hosting if the artifact contains native runtime binaries; do not ship Windows native binaries as a Linux runtime.
5. Use startup command `node server.js`. App Service provides `PORT`; bind `HOSTNAME=0.0.0.0`. Enable Always On if available on the selected plan, and set the health-check path to `/api/health`.
6. Verify HTTPS health, book-only and web-enabled answers, source order, streamed delivery, stop/error behavior, and history after reload on the hosted URL. A local test is not a hosted validation.

Azure keys must remain in App Service settings, never browser bundles. No prompt/body logging is added. Operational logs contain only status and safe error types. The standalone build is intentionally kept separate from the local `.env`.

## PoC limits and later work

- One question at a time in the UI; eight accepted requests/minute per App Service client-IP bucket (a shared bucket locally); four active requests/process. These in-memory limits reset on restart, are not distributed, and are not a spending cap.
- Current question: 2,000 characters; recent user-only context: bounded; retrieval: 15 candidates / up to five readable passages / 16,000 evidence characters. Output-token budgets include model reasoning as well as visible text.
- Server retries are disabled for generation to avoid duplicate streamed output/billing. Per-service deadlines and a total request deadline prevent indefinite work.
- Up to 30 conversations/100 messages per chat in this browser. Clearing site data removes them. Do not use shared-browser history for sensitive information.
- Production upgrades (sign-in, managed identities, distributed quotas, shared history, CI/CD, OCR repair, and corpus-wide evaluation) are out of scope.

## License

MIT; see [LICENSE](LICENSE).
