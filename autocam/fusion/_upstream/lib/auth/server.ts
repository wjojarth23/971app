import { betterAuth } from "better-auth";
import db, { Transaction } from "@/lib/db";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import * as schema from '../db/schema/auth';
import transporter from "../mailer";
import { eq } from "drizzle-orm";
import { TeamKeys } from "../db/schema/entities";
import { openAPI } from "better-auth/plugins";
import { routeResponse } from "../api/common";
import { NextRequest } from "next/server";
import { PgliteDatabase } from "drizzle-orm/pglite";
import { createKeyDigest } from "./keyDigest";

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: db instanceof PgliteDatabase ? "sqlite" : "pg",
    schema
  }),
  emailAndPassword: { enabled: true },
  emailVerification: {
    async sendVerificationEmail({ user, url }) {
      // Skip if the user is used by test cases
      if (user.email === "test@test.test") return;
      await transporter.sendMail({
        from: `"AutoCAM" <${process.env.SMTP_SENDER}>`,
        to: user.email,
        subject: "Verify your AutoCAM email!",
        text: `Click the link to verify your email: ${url}`
      })
    },
    sendOnSignUp: true,
    autoSignInAfterVerification: true,
  },
  user: {
    deleteUser: { enabled: true },
    changeEmail: { enabled: true }
  },
  baseURL: process.env.BASE_URL,
  plugins: [openAPI()],
})

export async function getKeyDigest(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (!authHeader) return;
  const token = authHeader.split("Bearer ")[1];
  return createKeyDigest(token);
}

export async function teamIdFromDigest(tx: Transaction, authType: AuthType) {
  if (!authType.keyDigest) throw routeResponse(401, { message: "API key not found" });
  const teamId = (await tx.query.TeamKeys.findFirst({
    where: eq(TeamKeys.digest, authType.keyDigest)
  }))?.team_id;
  if (!teamId) throw routeResponse(401, { message: "API key is not valid" });
  return teamId;
}

export interface AuthType {
  keyDigest?: string;
  userId?: string;
};
