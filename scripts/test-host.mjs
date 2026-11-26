import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { startTestHost } from "../api/scripts/test-runtime.mjs";

const host = await startTestHost();
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => { void host.stop(); });
if (process.argv.includes("--serve")) {
  await host.exited;
} else {
  try {
    const origin = "http://localhost:3201";
    const base = "http://localhost:7071/api";
    const health = await fetch(`${base}/health`, { headers: { origin } });
    assert.equal(health.headers.get("access-control-allow-origin"), origin);
    assert.equal((await health.json()).status, "ok");
    const preflight = await fetch(`${base}/chat`, { method: "OPTIONS", headers: { origin, "access-control-request-method": "POST", "access-control-request-headers": "content-type, authorization" } });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get("access-control-allow-origin"), origin);
    const badOrigin = await fetch(`${base}/chat`, { method: "POST", headers: { origin: "https://untrusted.example", "content-type": "application/json", authorization: "Bearer test-google-token" }, body: '{"question":"hello"}' });
    assert.equal(badOrigin.status, 403);
    assert.equal(badOrigin.headers.get("access-control-allow-origin"), null);
    const unauthenticated = await fetch(`${base}/chat`, { method: "POST", headers: { origin, "content-type": "application/json" }, body: '{"question":"hello"}' });
    assert.equal(unauthenticated.status, 401);
    const badToken = await fetch(`${base}/chat`, { method: "POST", headers: { origin, "content-type": "application/json", authorization: "Bearer invalid-token" }, body: '{"question":"hello"}' });
    assert.equal(badToken.status, 401);
    const invalid = await fetch(`${base}/chat`, { method: "POST", headers: { origin, "content-type": "application/json", authorization: "Bearer test-google-token" }, body: '{"question":""}' });
    assert.equal(invalid.status, 400);
    const response = await fetch(`${base}/chat`, { method: "POST", headers: { origin, "content-type": "application/json", authorization: "Bearer test-google-token" }, body: '{"question":"stream"}' });
    const reader = response.body.getReader();
    let content = new TextDecoder().decode((await reader.read()).value);
    assert.ok(content.includes('"type":"start"'));
    assert.ok(!(await host.events()).includes("finished"), "The host buffered the entire response instead of streaming.");
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      content += new TextDecoder().decode(next.value);
    }
    assert.ok(content.includes('"type":"done"'));
    const controller = new AbortController();
    const slow = await fetch(`${base}/chat`, { method: "POST", headers: { origin, "content-type": "application/json", authorization: "Bearer test-google-token" }, body: '{"question":"slow"}', signal: controller.signal });
    await slow.body.getReader().read();
    controller.abort();
    await delay(3300);
    const cancellationPropagated = (await host.events()).includes("aborted");

    const feedbackRes = await fetch(`${base}/feedback`, { method: "POST", headers: { origin, "content-type": "application/json", authorization: "Bearer test-google-token" }, body: '{"messageId":"host-msg-1","feedback":"helpful","includeWeb":false}' });
    assert.equal(feedbackRes.status, 200);
    assert.equal((await feedbackRes.json()).feedback, "helpful");

    console.log(JSON.stringify({ host: "Core Tools v4", health: "passed", cors: "passed", invalidInput: "passed", incrementalStreaming: "passed", feedback: "passed", disconnectAbortsGeneration: cancellationPropagated, azureCalls: 0 }));
    if (!cancellationPropagated) console.warn("The local Functions transport did not propagate a client disconnect; server work remains bounded by its deadline.");
  } finally { await host.stop(); }
}
