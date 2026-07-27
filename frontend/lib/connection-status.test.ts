/**
 * `connection-status.ts` is the single owner of label/pill/colour/needs-action
 * for four surfaces — the Banks tab, Settings, System status and the tab-bar
 * alert badge. Nothing renders it in this suite, so a careless edit here is
 * invisible: dropping `reconnect_required`, or flipping its `needsAction`,
 * would silently remove BOTH the tab-bar alert badge and Settings' Relink
 * button for a genuinely broken brokerage connection.
 *
 * Colours are asserted against COLORS rather than hex literals: the palette is
 * allowed to be retuned, the mapping is not.
 */
import { describe, expect, it } from "vitest";
import { COLORS } from "@/constants/theme";
import {
  connectionNeedsAction,
  connectionStatusColor,
  connectionStatusLabel,
  connectionStatusPill,
} from "./connection-status";

/** Both broken-connection statuses. They must stay indistinguishable to the UI. */
const BROKEN = ["relink_required", "reconnect_required"] as const;

describe("connectionStatusLabel", () => {
  it("reads as prose for every mapped status", () => {
    expect(connectionStatusLabel("active")).toBe("Live");
    expect(connectionStatusLabel("relink_required")).toBe("Relink needed");
    expect(connectionStatusLabel("reconnect_required")).toBe("Relink needed");
    expect(connectionStatusLabel("manual")).toBe("Manual");
  });

  it("humanizes an unmapped status instead of leaking the raw enum", () => {
    // The F7 defect verbatim: System status rendered `relink_required` at the user.
    expect(connectionStatusLabel("some_new_status")).toBe("Some new status");
    expect(connectionStatusLabel("broken")).toBe("Broken");
    expect(connectionStatusLabel("")).toBe("");
  });
});

describe("connectionStatusPill", () => {
  it("pins the device-verified Banks pill strings", () => {
    expect(connectionStatusPill("active")).toEqual({ label: "● Live", color: COLORS.moneyIn });
    expect(connectionStatusPill("relink_required")).toEqual({
      label: "⚠ Relink",
      color: COLORS.warning,
    });
    expect(connectionStatusPill("reconnect_required")).toEqual({
      label: "⚠ Relink",
      color: COLORS.warning,
    });
    expect(connectionStatusPill("manual")).toEqual({ label: "Manual", color: COLORS.textMuted });
  });

  it("shows nothing rather than guessing for an unmapped status", () => {
    expect(connectionStatusPill("some_new_status")).toBeNull();
  });
});

describe("connectionStatusColor", () => {
  it("maps every known status to its hue", () => {
    expect(connectionStatusColor("active")).toBe(COLORS.moneyIn);
    expect(connectionStatusColor("relink_required")).toBe(COLORS.warning);
    expect(connectionStatusColor("reconnect_required")).toBe(COLORS.warning);
    expect(connectionStatusColor("manual")).toBe(COLORS.textMuted);
  });

  it("treats an unmapped status as not-known-to-be-healthy", () => {
    expect(connectionStatusColor("some_new_status")).toBe(COLORS.warning);
    expect(connectionStatusColor("active_")).toBe(COLORS.warning);
  });

  it("mutes an absent status", () => {
    expect(connectionStatusColor(null)).toBe(COLORS.textMuted);
    expect(connectionStatusColor(undefined)).toBe(COLORS.textMuted);
    expect(connectionStatusColor("")).toBe(COLORS.textMuted);
  });
});

describe("connectionNeedsAction", () => {
  it("is true for exactly the statuses the user must repair", () => {
    for (const status of BROKEN) expect(connectionNeedsAction(status)).toBe(true);
  });

  it("is false for healthy and manual connections", () => {
    expect(connectionNeedsAction("active")).toBe(false);
    expect(connectionNeedsAction("manual")).toBe(false);
  });

  it("is false for an unmapped or absent status", () => {
    // An unknown status paints warning-coloured, but must not raise the tab-bar
    // alert badge — there is no relink flow that would clear it.
    expect(connectionNeedsAction("some_new_status")).toBe(false);
    expect(connectionNeedsAction(null)).toBe(false);
    expect(connectionNeedsAction(undefined)).toBe(false);
    expect(connectionNeedsAction("")).toBe(false);
  });
});

describe("the four surfaces cannot disagree", () => {
  it("presents relink_required and reconnect_required identically", () => {
    const [relink, reconnect] = BROKEN;
    expect(connectionStatusLabel(reconnect)).toBe(connectionStatusLabel(relink));
    expect(connectionStatusPill(reconnect)).toEqual(connectionStatusPill(relink));
    expect(connectionStatusColor(reconnect)).toBe(connectionStatusColor(relink));
    expect(connectionNeedsAction(reconnect)).toBe(connectionNeedsAction(relink));
  });

  it("keeps needs-action statuses off the healthy hue", () => {
    for (const status of BROKEN) {
      expect(connectionStatusColor(status)).not.toBe(connectionStatusColor("active"));
    }
  });
});
