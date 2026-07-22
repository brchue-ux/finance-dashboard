import { describe, it, expect } from "vitest";
import { excludeWealthsimpleMirrors } from "./net-worth-sources";

const ACCOUNTS = [
  { id: "1", name: "RBC Visa" },
  { id: "2", name: "Wealthsimple Chequing" },
  { id: "3", name: "Wealthsimple TFSA" },
  { id: "4", name: "Tangerine Chequing" },
  { id: "5", name: null },
];

describe("excludeWealthsimpleMirrors", () => {
  it("drops WS-named accounts when a portfolio snapshot is authoritative", () => {
    expect(excludeWealthsimpleMirrors(ACCOUNTS, true).map((a) => a.id)).toEqual(["1", "4", "5"]);
  });
  it("keeps everything when no portfolio snapshot exists — bank side is all we have", () => {
    expect(excludeWealthsimpleMirrors(ACCOUNTS, false)).toHaveLength(5);
  });
});
