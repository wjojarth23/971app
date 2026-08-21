import { createSelectSchema } from "drizzle-zod";
import { TeamInvites, TeamMembers } from "@/lib/db/schema/entities";
import zod from "zod";

import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth/server";
import { headers } from "next/headers";
import { routeFactory, routeResponse, parseSchema } from "../common";

const Invite = createSelectSchema(TeamInvites).extend({ team: zod.string() });

export const GET = routeFactory(async (req, authType, tx) => {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return routeResponse(401);
  return routeResponse(
    200,
    await parseSchema(
      (
        await tx.query.TeamInvites.findMany({
          with: { team: true },
          where: eq(TeamInvites.email, session.user.email),
        })
      ).map((x) => ({
        ...x,
        team: x.team ? (x.team as { name: string }).name : "",
      })),
      zod.array(Invite)
    )
  );
}, { user: {} });

export const Accept = routeFactory<string>(async (req, authType, tx, id) => {
  if (!id) return routeResponse(422);
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return routeResponse(401, { message: "User session not found" });
  
  const invite = await tx.query.TeamInvites.findFirst({
    where: eq(TeamInvites.id, id)
  });
  if (!invite) return routeResponse(404);
  if (session.user.email !== invite.email) return routeResponse(403, { message: "User email does not match invite email" });

  await tx.delete(TeamInvites).where(eq(TeamInvites.id, id));
  await tx.insert(TeamMembers).values({
    team_id: invite.team_id,
    user_id: authType.userId!,
    admin: invite.admin
  });

  const redirectBase = process.env.BASE_URL ?? req.url;
  // If accessed directly (email link), redirect to dashboard using configured base URL.
  return NextResponse.redirect(new URL("/dashboard", redirectBase));
}, { user: {}, idSchema: zod.uuid() });

export const DELETE = routeFactory<string>(async (req, authType, tx, id) => {
  if (!id) return routeResponse(422);
  const invite = await tx.query.TeamInvites.findFirst({
    where: eq(TeamInvites.id, id)
  });
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return routeResponse(401, { message: "User session not found" });

  if (invite?.email !== session.user.email)
    return routeResponse(401);
  await tx.delete(TeamInvites).where(eq(TeamInvites.id, id));
}, { user: {}, idSchema: zod.uuid() });
