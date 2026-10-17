import { describe, expect, it, vi } from "vitest";
import { listDecks } from "../lib/decks";
import { createApp } from "./app";

vi.mock("../lib/decks", () => ({ listDecks: vi.fn() }));

const app = createApp(async () => "secret");
const auth = { headers: { Authorization: "Bearer secret" } };

describe("agent API", () => {
  it("refuses a request without the token", async () => {
    const res = await app.request("/decks");
    expect(res.status).toBe(401);
    expect(listDecks).not.toHaveBeenCalled();
  });

  it("refuses a wrong token", async () => {
    const res = await app.request("/decks", { headers: { Authorization: "Bearer nope" } });
    expect(res.status).toBe(401);
  });

  it("guards unknown routes too", async () => {
    expect((await app.request("/nothing-here")).status).toBe(401);
    expect((await app.request("/nothing-here", auth)).status).toBe(404);
  });

  it("lets nothing in while the API is off", async () => {
    const off = createApp(async () => null);
    expect((await off.request("/decks", auth)).status).toBe(401);
    expect((await off.request("/decks")).status).toBe(401);
  });

  it("lists decks", async () => {
    vi.mocked(listDecks).mockResolvedValueOnce([
      { id: "d1", name: "Atraxa", format: "commander", notes: "", createdAt: "", updatedAt: "" },
    ]);
    const res = await app.request("/decks", auth);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([expect.objectContaining({ id: "d1", name: "Atraxa" })]);
  });

  it("reports a failure as JSON", async () => {
    vi.mocked(listDecks).mockRejectedValueOnce(new Error("database is locked"));
    const res = await app.request("/decks", auth);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "database is locked" });
  });
});
