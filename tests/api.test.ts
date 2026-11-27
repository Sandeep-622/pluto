import { afterEach, expect, it, vi } from "vitest";
import { apiUrl } from "@/lib/api";

afterEach(() => vi.unstubAllEnvs());
it("uses a separate API origin for chat and health", () => {
  vi.stubEnv("NEXT_PUBLIC_API_BASE_URL", "https://api.example.test/");
  expect(apiUrl("chat")).toBe("https://api.example.test/api/chat");
  expect(apiUrl("health")).toBe("https://api.example.test/api/health");
});
it.each(["", "not a URL", "http://remote.example", "https://key@api.example.test", "https://api.example.test/api", "https://api.example.test?key=secret"])("rejects unsafe or missing API configuration: %s", (value) => {
  vi.stubEnv("NEXT_PUBLIC_API_BASE_URL", value);
  expect(() => apiUrl("chat")).toThrow();
});
