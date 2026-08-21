import { PGlite } from "@electric-sql/pglite";
import { drizzle } from 'drizzle-orm/pglite';
import { vitest } from "vitest";
import schema from '@/lib/db/schema';
import { generateDrizzleJson, generateMigration } from "drizzle-kit/api";

vitest.mock("@/lib/db", async () => {
  const client = new PGlite();
  const mockDB = drizzle(client, { schema });
  const statements = await generateMigration(
    await generateDrizzleJson({}),
    await generateDrizzleJson(schema)
  );
  for (const statement of statements)
    await mockDB.execute(statement);
  return { default: mockDB };
});