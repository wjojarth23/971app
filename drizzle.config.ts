import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './lib/db/schema/*',
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.ADMIN_DB_URL!,
  }
});