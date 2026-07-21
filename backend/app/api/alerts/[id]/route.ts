/**
 * PATCH  /api/alerts/:id — edit / pause / re-arm a standing price alert.
 *                          Re-arm = status "active" on a triggered alert.
 * DELETE /api/alerts/:id
 */
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth-guard";
import { db } from "@/db";
import { priceAlerts } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

const patchSchema = z
  .object({
    status: z.enum(["active", "paused"]).optional(),
    label: z.string().max(80).nullable().optional(),
    threshold: z.number().positive().optional(),
    extendedHours: z.boolean().optional(),
    cooldownSeconds: z.number().int().positive().nullable().optional(),
    expiresAt: z.number().int().positive().nullable().optional(),
  })
  .refine((b) => Object.keys(b).length > 0, { message: "empty patch" });

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const authed = await requireUser(req);
  if ("response" in authed) return authed.response;
  const { id } = await ctx.params;

  const parsed = patchSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }
  const body = parsed.data;
  const now = Math.floor(Date.now() / 1000);

  const [existing] = await db
    .select()
    .from(priceAlerts)
    .where(and(eq(priceAlerts.id, id), eq(priceAlerts.userId, authed.userId)))
    .limit(1);
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await db
    .update(priceAlerts)
    .set({
      ...(body.status !== undefined && {
        status: body.status,
        // re-arming clears the cooldown gate so the next poll evaluates immediately
        ...(body.status === "active" && { nextCheckAt: null }),
      }),
      ...(body.label !== undefined && { label: body.label }),
      ...(body.threshold !== undefined && { threshold: body.threshold }),
      ...(body.extendedHours !== undefined && { extendedHours: body.extendedHours ? 1 : 0 }),
      ...(body.cooldownSeconds !== undefined && { cooldownSeconds: body.cooldownSeconds }),
      ...(body.expiresAt !== undefined && { expiresAt: body.expiresAt }),
      updatedAt: now,
    })
    .where(eq(priceAlerts.id, id));

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const authed = await requireUser(req);
  if ("response" in authed) return authed.response;
  const { id } = await ctx.params;

  const result = await db
    .delete(priceAlerts)
    .where(and(eq(priceAlerts.id, id), eq(priceAlerts.userId, authed.userId)));

  if (result.rowsAffected === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
