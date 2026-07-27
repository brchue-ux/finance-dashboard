/**
 * F6 regression — /api/llm/analyze returned 500 for every client mistake.
 *
 * Malformed JSON, an empty body, an unknown `view`, and a missing
 * ANTHROPIC_API_KEY all produced an unstructured 500. `view` in particular was
 * only cast (`as CardView`) and then used as half of llm_analysis_cache's
 * unique index, so an arbitrary string reached the database as a cache key.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/auth-guard", () => ({
  requireUser: vi.fn(async () => ({ userId: "user-1" })),
}));

const generateCards = vi.fn(async () => [{ kind: "insight", title: "ok" }]);
vi.mock("@/lib/llm/advisory", () => ({
  generateCards: (...args: unknown[]) => generateCards(...(args as [])),
}));

/** No cache rows and no connections: every request takes the cold-start path. */
const inserted: unknown[] = [];
vi.mock("@/db", () => ({
  db: {
    select: () => ({
      from: () => ({ where: () => ({ limit: async () => [] }) }),
    }),
    insert: () => ({
      values: (row: unknown) => ({
        onConflictDoUpdate: async () => {
          inserted.push(row);
        },
      }),
    }),
  },
}));

const { POST } = await import("./route");

function analyzeRequest(body: string): NextRequest {
  return new NextRequest("http://localhost:3021/api/llm/analyze", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
}

beforeEach(() => {
  inserted.length = 0;
  generateCards.mockReset();
  generateCards.mockResolvedValue([{ kind: "insight", title: "ok" }]);
});

describe("POST /api/llm/analyze — input validation", () => {
  it("returns 400 for a malformed JSON body", async () => {
    const res = await POST(analyzeRequest("not-json"));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ code: "INVALID_BODY" });
    expect(generateCards).not.toHaveBeenCalled();
  });

  it("returns 400 for an empty body", async () => {
    const res = await POST(analyzeRequest(""));
    expect(res.status).toBe(400);
    expect(generateCards).not.toHaveBeenCalled();
  });

  it("returns 400 for an unknown view instead of writing it as a cache key", async () => {
    const res = await POST(analyzeRequest(JSON.stringify({ view: "totally-made-up" })));
    expect(res.status).toBe(400);
    expect(generateCards).not.toHaveBeenCalled();
    expect(inserted).toEqual([]);
  });

  it("returns 400 when view is missing", async () => {
    const res = await POST(analyzeRequest(JSON.stringify({ force: true })));
    expect(res.status).toBe(400);
  });

  it("returns 400 when view is not a string", async () => {
    const res = await POST(analyzeRequest(JSON.stringify({ view: { budget: true } })));
    expect(res.status).toBe(400);
  });

  it("accepts the two known views", async () => {
    for (const view of ["budget", "portfolio"]) {
      const res = await POST(analyzeRequest(JSON.stringify({ view })));
      expect(res.status).toBe(200);
    }
    expect(generateCards).toHaveBeenCalledTimes(2);
  });
});

describe("POST /api/llm/analyze — generation failure", () => {
  it("returns 503, not 500, when the provider is unavailable or unconfigured", async () => {
    generateCards.mockRejectedValue(new Error("Anthropic API key is missing."));
    const res = await POST(analyzeRequest(JSON.stringify({ view: "budget" })));
    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toMatchObject({ code: "ANALYSIS_UNAVAILABLE" });
    expect(inserted).toEqual([]);
  });
});
