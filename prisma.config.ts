import 'dotenv/config'
import { defineConfig } from 'prisma/config'

/**
 * Prisma 7 configuration.
 *
 * The datasource URL lives here rather than in schema.prisma. Migrate uses
 * DIRECT_URL when set — required when DATABASE_URL points at a connection
 * pooler (PgBouncer, Supabase pooler, Neon pooled endpoint), because Migrate
 * needs a session-mode connection to take advisory locks.
 */
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    // Read via process.env rather than Prisma's env() helper, which throws on
    // an unset variable and so cannot express this fallback.
    url: process.env.DIRECT_URL || process.env.DATABASE_URL || '',

    // Required by `prisma migrate diff --from-migrations`, which CI uses to catch
    // a schema.prisma change that was committed without a matching migration.
    // Prisma creates and drops this database around each run.
    shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL || undefined,
  },
})
