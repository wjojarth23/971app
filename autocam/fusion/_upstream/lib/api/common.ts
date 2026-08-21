import { ResponseConfig, RouteConfig } from "@asteasolutions/zod-to-openapi";
import zod, { ZodObject, ZodType } from "zod";
import { registry } from "../openapi/registry";
import { apiKey, userSession } from "./auth";
import { paginateListObjectsV2, PutObjectTaggingCommand } from "@aws-sdk/client-s3";
import { DrizzleQueryError, and, eq, arrayContains } from "drizzle-orm";
import { NextResponse, NextRequest } from "next/server";
import { DatabaseError } from "pg";
import { auth, AuthType, getKeyDigest } from "../auth/server";
import { client } from "../aws";
import db, { Transaction } from "../db";
import { TeamMembers, TeamKeys } from "../db/schema/entities";
import { Context } from "../trpc/server";
import { TRPCError } from "@trpc/server";

export const CommonAuthorization: Record<string, ResponseConfig> = {
  401: {
    description: "Unauthorized. Due to missing or invalid authentication",
    content: {
      "application/json": {
        schema: zod.object({
          message: zod.string()
        })
      }
    }
  },
  403: {
    description: "Forbidden. You do not have permission to access this resource or perform this action. This includes not having your email verified",
    content: {
      "application/json": {
        schema: zod.object({
          message: zod.string()
        })
      }
    }
  }
};

export const NotFound: Record<string, ResponseConfig> = {
  404: {
    description: "Not Found. The requested resource was not found."
  }
}

export const Conflict: Record<string, ResponseConfig> = {
  409: {
    description: "There was a conflict with creating the requested resource."
  }
};

const ValidationIssue = zod.object({
  code: zod.string(),
  message: zod.string(),
}).openapi("Validation Issue")
export const ValidationError: Record<string, ResponseConfig> = {
  422: {
    description: "Unprocessable Entity. Usually due to missing or invalid parameters.",
    content: {
      "application/json": {
        schema: zod.array(ValidationIssue)
      }
    }
  }
};

/**
 * Register an endpoint that has two variants: /api/... and /api/teams/:id/...
 */
export function registerTeamEndpoint(scopes: string[], config: RouteConfig, userOverride?: object, apiKeyOverride?: object) {
  // API Key variant - this one is easier
  registry.registerPath({
    ...config,
    summary: config.summary ? config.summary + " (API Key)" : config.summary,
    security: [{ [apiKey.name]: scopes }],
    ...apiKeyOverride
  });

  let params: ZodObject = zod.object({ id: zod.number().openapi({ description: "ID of the team" }) });
  if (config.request?.params)
    params = (config.request.params as ZodObject).extend(params);

  // User variant
  registry.registerPath({
    ...config,
    path: `/api/teams/{id}/${config.path.split("/api/").slice(1)}`,
    summary: config.summary ? config.summary + " (User)" : config.summary,
    security: [{ [userSession.name]: [] }],
    request: {
      ...config.request,
      params,
    },
    responses: {
      ...config.responses,
      ...ValidationError
    },
    ...userOverride
  })
}

/**
 * Get authenticated user ID only (for operations that require email verification)
 */
export async function getUserId(req: NextRequest): Promise<string | undefined> {
  const session = await auth.api.getSession({ headers: req.headers });
  return session?.user.id;
}

/**
 * Get authentication context with both userId and keyDigest
 */
export async function getAuthType(req: NextRequest): Promise<AuthType> {
  return {
    userId: await getUserId(req),
    keyDigest: await getKeyDigest(req)
  };
}

/**
 * Validate and parse request body against a Zod schema
 */
export async function parseSchema<T extends ZodType>(json: unknown, schema: T): Promise<zod.infer<typeof schema>> {
  const result = await schema.safeParseAsync(json);
  if (!result.success) {
    throw NextResponse.json(result.error.issues, { status: 422 });
  }
  return result.data;
}

export async function parseFormData<T extends zod.ZodType>(formData: FormData, schema: T): Promise<zod.infer<typeof schema>> {
  const rawData: Record<string, File | string | object> = {};
  
  formData.forEach((value, key) => {
    if (key === 'data' && typeof value === 'string') {
      try {
        rawData[key] = JSON.parse(value);
      } catch {
        throw routeResponse(422, { message: "Unable to parse JSON" });
      }
    } else
      rawData[key] = value;
  });

  return parseSchema(rawData, schema);
}

/**
 * Common error handling for database operations
 * Converts DatabaseError codes to appropriate HTTP status codes
 */
export function handleDatabaseError(err: unknown): NextResponse {
  let cause = err;
  if (err instanceof DrizzleQueryError)
    cause = err.cause as DatabaseError;
  if (cause instanceof DatabaseError) {
    switch (cause.code) {
      case "23505":
      case "23503": return routeResponse(409);
    }
  }
  throw err;
}

export function routeResponse(status = 200, data?: object) {
  if (data === undefined)
    return new NextResponse(null, { status });
  return NextResponse.json(data, { status });
}

export async function checkUserTeam(tx: Transaction, authType: AuthType, tid: number | undefined, admin: boolean = false) {
  if (!tid) throw routeResponse(404);
  if (!authType.userId) return;
  const member = await tx.query.TeamMembers.findFirst({
    where: and(
      eq(TeamMembers.user_id, authType.userId),
      eq(TeamMembers.team_id, tid)
    )
  });
  if (!member) throw routeResponse(403, { message: "The user is not part of the team" });
  if (admin && !member.admin) throw routeResponse(403, { message: "The user is not an admin" });
}

export async function checkUserTeamTRPC(ctx: Context, tid: number, admin: boolean = false) {
  if (!ctx.session) return;
  const member = await db.query.TeamMembers.findFirst({
    where: and(
      eq(TeamMembers.user_id, ctx.session.user.id),
      eq(TeamMembers.team_id, tid)
    )
  });
  if (!member) throw new TRPCError({ code: "FORBIDDEN" });
  if (admin && !member.admin) throw new TRPCError({ code: "FORBIDDEN" });
}

export enum IDPolicy {
  // The route cannot have an ID
  Forbidden,
  // The route must have an ID
  Required
};

export interface RouteFactoryConfig<T> {
  user?: {
    // Whether the email needs to be verified
    emailVerified?: boolean;
    idPolicy?: IDPolicy
  },
  apiKey?: {
    scopes: string[],
    idPolicy?: IDPolicy
  }
  idSchema?: ZodType<T>
}

export type RouteFactoryCallback<T> = (req: NextRequest, authType: AuthType, tx: Transaction, id: T | null) => Promise<NextResponse | undefined>;

export function routeFactory<T = number>(callback: RouteFactoryCallback<T>, config: RouteFactoryConfig<T>) {
  return async (req: NextRequest, { params }: { params: Promise<object | undefined> }) => {
    try {
      const authType = await getAuthType(req);
      let id: T | null = null;
      const p = await params;
      const hasId = p !== undefined && "id" in p;
      if (authType.userId) {
        if (!config.user)
          throw routeResponse(403, { message: "Users are not allowed to use this route" });
        const session = (await auth.api.getSession({ headers: req.headers }))!;
        if ((config.user.emailVerified ?? false) && !session.user.emailVerified)
          throw routeResponse(403, { message: "User email has not been verified" });
        if (config.user.idPolicy === IDPolicy.Forbidden && hasId)
          throw routeResponse(400, { message: "User cannot have an ID parameter" });
        else if (config.user.idPolicy === IDPolicy.Required && !hasId)
          throw routeResponse(400, { message: "User must have an ID parameter" })
      } else if (authType.keyDigest) {
        if (!config.apiKey)
          throw routeResponse(403, { message: "API keys are not allowed to use this route" });
        if (config.apiKey.idPolicy === IDPolicy.Forbidden && hasId)
          throw routeResponse(400, { message: "API key cannot have an ID parameter" });
        else if (config.apiKey.idPolicy === IDPolicy.Required && !hasId)
          throw routeResponse(400, { message: "API key must have an ID parameter" })
        const key = await db.query.TeamKeys.findFirst({
          where: and(
            eq(TeamKeys.digest, authType.keyDigest),
            arrayContains(TeamKeys.scopes, config.apiKey.scopes)
          )
        });
        if (!key) throw routeResponse(403, { message: "API Key does not have the required scopes for this endpoint" });
      } else throw routeResponse(401, { message: "No valid form of authentication found" });
      if (hasId) {
        const schema = (config.idSchema ?? zod.coerce.number().positive()) as ZodType<T>;
        id = await parseSchema(p.id, schema);
      }

      return await db.transaction(async tx => {
        const result = await callback(req, authType, tx, id);
        if (result === undefined) return routeResponse(204);
        return result;
      });
    } catch (err) {
      if (err instanceof NextResponse) return err;
      if (err instanceof DatabaseError || err instanceof DrizzleQueryError)
        return handleDatabaseError(err);
      throw err;
    }
  }
}

export async function s3DeleteWithPrefix(Prefix: string) {
  const paginator = paginateListObjectsV2(
    { client },
    { Bucket: process.env.AUTOCAM_BUCKET, Prefix }
  );
  for await (const page of paginator) {
    const objects = page.Contents ?? [];
    const tagPromises = objects.map(obj => {
      return client.send(new PutObjectTaggingCommand({
        Bucket: process.env.AUTOCAM_BUCKET,
        Key: obj.Key,
        Tagging: { TagSet: [{ Key: "delete", Value: "true" }] }
      }));
    });
    await Promise.all(tagPromises);
  }
}