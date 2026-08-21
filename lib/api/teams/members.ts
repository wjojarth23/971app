import { teamIdFromDigest } from "@/lib/auth/server";
import { TeamMembers } from "@/lib/db/schema/entities";
import { Teams } from "@/lib/db/schema/core";
import { user } from "@/lib/db/schema/auth";
import { and, eq } from "drizzle-orm";
import zod from "zod";
import { checkUserTeam, CommonAuthorization, IDPolicy, parseSchema, registerTeamEndpoint, routeFactory, routeResponse, ValidationError } from "../common";
import { scopeNames as scopes } from "@/lib/scopes";
import { registry } from "@/lib/openapi/registry";
import { createSelectSchema } from "drizzle-zod";

const Member = createSelectSchema(TeamMembers).omit({ user_id: true, team_id: true })
  .extend(createSelectSchema(user).pick({ email: true, name: true }).shape)
  .extend({ isOwner: zod.boolean() });

registerTeamEndpoint([scopes.teams.read], {
  method: "get",
  path: "/api/members",
  tags: ["Teams"],
  summary: "Get Team Members",
  responses: {
    200: {
      description: "Returns the members of the team",
      content: {
        "application/json": {
          schema: zod.array(Member)
        }
      }
    },
    ...CommonAuthorization
  }
}, {}, { path: "/api/teams/members" });

export const GET = routeFactory(async (req, authType, tx, id) => {
  id ??= await teamIdFromDigest(tx, authType);
  await checkUserTeam(tx, authType, id);
  
  const team = await tx.query.Teams.findFirst({
    where: eq(Teams.id, id),
    columns: { owner: true }
  });
  const ownerId = team?.owner ?? null;

  return routeResponse(200, await parseSchema((await tx.query.TeamMembers.findMany({
    where: eq(TeamMembers.team_id, id),
    with: { user: true },
  })).map(x => ({ ...x, ...x.user, isOwner: ownerId === x.user_id })), zod.array(Member)));
}, {
  user: { idPolicy: IDPolicy.Required },
  apiKey: { scopes: [scopes.teams.read], idPolicy: IDPolicy.Forbidden }
});

const UpdateSchema = zod.object({ 
  email: zod.email(),
  admin: zod.boolean()
});

registry.registerPath({
  method: "patch",
  path: "/api/teams/{id}/members",
  tags: ["Teams"],
  summary: "Update Team Member Role",
  request: {
    params: zod.object({ id: zod.number().openapi({ description: "Team ID" }) }),
    body: {
      content: {
        "application/json": {
          schema: UpdateSchema
        }
      }
    }
  },
  responses: {
    204: {
      description: "Member role updated successfully"
    },
    ...CommonAuthorization,
    ...ValidationError
  }
});

export const PATCH = routeFactory(async (req, authType, tx, team_id) => {
  team_id ??= await teamIdFromDigest(tx, authType);
  await checkUserTeam(tx, authType, team_id, true);

  const { email, admin } = await parseSchema(await req.json(), UpdateSchema);

  // Find the user by email
  const foundUser = await tx.query.user.findFirst({
    where: eq(user.email, email)
  });

  if (!foundUser) {
    return routeResponse(404, { message: "User not found" });
  }

  await tx
    .update(TeamMembers)
    .set({ admin })
    .where(
      and(
        eq(TeamMembers.team_id, team_id),
        eq(TeamMembers.user_id, foundUser.id)
      )
    );

  return routeResponse(204);
}, { user: { emailVerified: true } });

const DeleteSchema = zod.object({ email: zod.email() });

registry.registerPath({
  method: "delete",
  path: "/api/teams/{id}/members",
  tags: ["Teams"],
  summary: "Remove Team Member",
  request: {
    params: zod.object({ id: zod.number().openapi({ description: "Team ID" }) }),
    query: DeleteSchema
  },
  responses: {
    204: {
      description: "Member removed successfully"
    },
    ...CommonAuthorization,
    ...ValidationError
  }
});

export const DELETE = routeFactory(async (req, authType, tx, team_id) => {
  team_id ??= await teamIdFromDigest(tx, authType);

  const { email } = await parseSchema({
    email: req.nextUrl.searchParams.get("email")
  }, DeleteSchema);

  // Find the user by email
  const foundUser = await tx.query.user.findFirst({
    where: eq(user.email, email)
  });

  if (!foundUser) {
    return routeResponse(404, { message: "User not found" });
  }

  // Check if user is removing themselves (leaving the team)
  const isRemovingSelf = authType.userId === foundUser.id;

  if (isRemovingSelf) {
    // User can always leave the team themselves (just need to be a member)
    await checkUserTeam(tx, authType, team_id, false);
  } else {
    // Removing someone else requires admin privileges
    await checkUserTeam(tx, authType, team_id, true);
  }

  await tx
    .delete(TeamMembers)
    .where(
      and(
        eq(TeamMembers.team_id, team_id),
        eq(TeamMembers.user_id, foundUser.id)
      )
    );

  return routeResponse(204);
}, { user: { emailVerified: true } });
