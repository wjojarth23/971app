import { initTRPC, TRPCError } from '@trpc/server';
import { OpenApiMeta } from 'trpc-to-openapi';
import { auth } from '../auth/server';
import crypto from "crypto";
import { FetchCreateContextFnOptions } from '@trpc/server/adapters/fetch';
import db from '../db';
import { TeamKeys } from '../db/schema/entities';
import { eq } from 'drizzle-orm';

export async function createContext({ req }: FetchCreateContextFnOptions) {
  const session = await auth.api.getSession({ headers: req.headers });
  let apiKey = req.headers.get("authorization");
  if (apiKey)
    apiKey = crypto.createHmac("sha256", "key").update(apiKey.split(" ")[1]).digest("hex");
  return { session, apiKey };
}

export type Context = Awaited<ReturnType<typeof createContext>>;

type Meta = OpenApiMeta & {
  authStrategies: ('user' | 'apiKey')[];
  emailVerified?: boolean;
  scopes?: string[];
};

const t = initTRPC.meta<Meta>().context<Context>().create({
  defaultMeta: { authStrategies: [] }
});

export const router = t.router;
export const procedure = t.procedure.use(async opts => {
  if (opts.meta?.authStrategies.length === 0)
    return opts.next();

  if (opts.meta?.authStrategies.includes('user') && opts.ctx.session) {
    if (!((opts.meta?.emailVerified ?? false) && !(opts.ctx.session.user.emailVerified)))
      return opts.next();
  }

  if (opts.meta?.authStrategies.includes('apiKey') && opts.ctx.apiKey) {
    const key = await db.query.TeamKeys.findFirst({ where: eq(TeamKeys.digest, opts.ctx.apiKey) });
    if (!key) throw new TRPCError({ code: "UNAUTHORIZED" });
    if (!(opts.meta?.scopes || []).every(x => key.scopes.includes(x)))
      throw new TRPCError({ code: "FORBIDDEN" });
    return opts.next();
  }

  throw new TRPCError({ code: "UNAUTHORIZED" });
});
