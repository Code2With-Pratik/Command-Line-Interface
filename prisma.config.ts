import 'dotenv/config';
import { defineConfig } from 'prisma/config';

// Prisma 7 moves connection URLs out of schema.prisma into this config.
// Used by migration/introspection commands (e.g. `prisma db push`).
// The app's *runtime* connection is created from the pg driver adapter in src/lib/db.ts.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    url: process.env.DIRECT_URL || process.env.DATABASE_URL || '',
  },
});
