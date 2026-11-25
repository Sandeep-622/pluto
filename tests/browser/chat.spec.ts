import { expect, test, type Page } from "@playwright/test";
import type { ChatEvent } from "../../src/lib/contract";

const bookEvents: ChatEvent[] = [
  { type: "start", section: "books" },
  { type: "delta", section: "books", text: "This is a supported book explanation of headache. [B1]" },
  { type: "sources", section: "books", sources: [{ kind: "books", id: "B1", title: "Clinical Medicine.pdf" }] },
  { type: "section-done", section: "books" },
  { type: "done" }
];
const encode = (events: ChatEvent[]) => events.map((event) => JSON.stringify(event)).join("\n") + "\n";

function makeTestJwt(overrides: Record<string, unknown> = {}) {
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({
    sub: "google-reader-1",
    email: "reader@example.com",
    name: "Pluto Reader",
    email_verified: true,
    exp: Math.floor(Date.now() / 1000) + 3600,
    ...overrides
  })).toString("base64url");
  return `${header}.${payload}.pluto-test-sig`;
}

async function signIn(page: Page) {
  await page.getByRole("button", { name: "Sign in with Google" }).click();
  await expect(page.getByLabel("Your medical book question")).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  const testToken = makeTestJwt();
  await page.addInitScript((credential: string) => {
    let onCredential: ((response: { credential?: string }) => void) | undefined;
    (window as unknown as { google: unknown }).google = {
      accounts: {
        id: {
          initialize(config: { callback: (response: { credential?: string }) => void }) {
            onCredential = config.callback;
          },
          renderButton(parent: HTMLElement) {
            const button = document.createElement("button");
            button.type = "button";
            button.textContent = "Sign in with Google";
            button.addEventListener("click", () => onCredential?.({ credential }));
            parent.appendChild(button);
          },
          disableAutoSelect() {}
        }
      }
    };
  }, testToken);
  await page.route("**/api/health", (route) => route.fulfill({ json: { status: "ok", webAvailable: true } }));
});

test("requires Google sign-in before chatting, persists session, and supports sign-out", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Sign in with Google to ask questions")).toBeVisible();
  await expect(page.getByLabel("Your medical book question")).toHaveCount(0);

  await signIn(page);
  await expect(page.getByText("reader@example.com")).toBeVisible();

  await page.reload();
  await expect(page.getByLabel("Your medical book question")).toBeVisible();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByText("Sign in with Google to ask questions")).toBeVisible();
});

test("book-only chat has citations and browser history, and can be cleared", async ({ page }) => {
  let includeWeb: unknown;
  let authHeader: string | undefined;
  await page.route("**/api/chat", (route) => {
    includeWeb = route.request().postDataJSON().includeWeb;
    authHeader = route.request().headers()["authorization"];
    return route.fulfill({ contentType: "application/x-ndjson", body: encode(bookEvents) });
  });
  await page.goto("/");
  await signIn(page);
  await expect(page.getByRole("checkbox", { name: "Include web" })).not.toBeChecked();
  await page.getByLabel("Your medical book question").fill("What causes headache?");
  await page.getByRole("button", { name: "Send question" }).click();
  await expect(page.getByText("This is a supported book explanation", { exact: false })).toBeVisible();
  await expect(page.getByLabel("Book citations")).toContainText("Clinical Medicine");
  expect(includeWeb).toBe(false);
  expect(authHeader).toMatch(/^Bearer /);
  await page.reload();
  await expect(page.getByLabel("Book citations")).toContainText("Clinical Medicine");
  await page.getByRole("button", { name: "New conversation", exact: false }).click();
  await expect(page.getByRole("heading", { name: "A question is a good place to start." })).toBeVisible();
  page.on("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Clear history" }).click();
  await page.reload();
  await expect(page.getByText("Your conversations will live here.", { exact: false })).toBeVisible();
});

test("opt-in web content and citations appear before books and restore with their mode", async ({ page }) => {
  const events: ChatEvent[] = [
    { type: "start", section: "web" },
    { type: "delta", section: "web", text: "An official website explains this topic." },
    { type: "sources", section: "web", sources: [{ kind: "web", id: "W1", title: "NHS headache information", url: "https://www.nhs.uk/conditions/headaches/" }] },
    { type: "section-done", section: "web" }, ...bookEvents
  ];
  await page.route("**/api/chat", (route) => {
    expect(route.request().postDataJSON().includeWeb).toBe(true);
    return route.fulfill({ contentType: "application/x-ndjson", body: encode(events) });
  });
  await page.goto("/");
  await signIn(page);
  await page.getByRole("checkbox", { name: "Include web" }).check();
  await page.getByLabel("Your medical book question").fill("Explain headache");
  await page.getByRole("button", { name: "Send question" }).click();
  await expect(page.getByRole("link", { name: /NHS headache information/ })).toHaveAttribute("href", "https://www.nhs.uk/conditions/headaches/");
  const sections = page.locator(".answer-section");
  await expect(sections.nth(0)).toHaveAttribute("aria-label", "Web findings");
  await expect(sections.nth(1)).toHaveAttribute("aria-label", "From the books");
  await page.reload();
  await expect(page.getByLabel("Website citations")).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "Include web" })).not.toBeChecked();
  await page.getByRole("button", { name: "New conversation", exact: false }).click();
  await expect(page.getByRole("checkbox", { name: "Include web" })).not.toBeChecked();
});

test("a failed web section is visible while the book answer remains usable", async ({ page }) => {
  await page.route("**/api/chat", (route) => route.fulfill({ contentType: "application/x-ndjson", body: encode([
    { type: "start", section: "web" },
    { type: "error", section: "web", message: "Web research failed. This section is unverified." },
    ...bookEvents
  ]) }));
  await page.goto("/");
  await signIn(page);
  await page.getByRole("checkbox", { name: "Include web" }).check();
  await page.getByLabel("Your medical book question").fill("Headache");
  await page.getByRole("button", { name: "Send question" }).click();
  await expect(page.getByText("Web research failed. This section is unverified.")).toBeVisible();
  await expect(page.getByLabel("Book citations")).toBeVisible();
});

test("interrupted responses are not presented as complete", async ({ page }) => {
  await page.route("**/api/chat", (route) => route.fulfill({ contentType: "application/x-ndjson", body: encode([
    { type: "start", section: "books" }, { type: "delta", section: "books", text: "Partial answer" }
  ]) }));
  await page.goto("/");
  await signIn(page);
  await page.getByLabel("Your medical book question").fill("Headache");
  await page.getByRole("button", { name: "Send question" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "before the answer finished" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Send question" })).toBeVisible();
});

test("mobile layout keeps the composer accessible and navigation usable", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await signIn(page);
  await expect(page.getByLabel("Your medical book question")).toBeVisible();
  await page.getByRole("button", { name: "Open navigation" }).click();
  await expect(page.getByRole("button", { name: "New conversation", exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Close navigation" }).click({ position: { x: 350, y: 100 } });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("static UI streams from the actual cross-origin Functions host", async ({ page }) => {
  await page.unroute("**/api/health");
  await page.goto("/");
  await signIn(page);
  await page.getByLabel("Your medical book question").fill("Local integration");
  await page.getByRole("button", { name: "Send question" }).click();
  await expect(page.getByText("Local Functions streaming is working.", { exact: false })).toBeVisible();
  await expect(page.getByLabel("Book citations")).toContainText("Local mock book");
  await expect(page.getByRole("button", { name: "Send question" })).toBeVisible();
});

test("stopping a real cross-origin stream leaves the UI usable", async ({ page }) => {
  await page.goto("/");
  await signIn(page);
  await page.getByLabel("Your medical book question").fill("slow");
  await page.getByRole("button", { name: "Send question" }).click();
  await expect(page.getByText("Local Functions streaming is working.", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Stop response" }).click();
  await expect(page.getByRole("button", { name: "Send question" })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Your medical book question")).toBeEnabled();
});
