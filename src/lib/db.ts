import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "@/generated/prisma/client";

// Prisma 7 requires an explicit driver adapter. `adapter-pg` speaks plain TCP,
// which works against both the local dev Postgres (`npm run db:up`) and Neon,
// so local and deployed builds share one code path.
function createClient() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set — copy .env.example to .env");
  }
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}

// Next.js dev server re-evaluates modules on hot reload; without the global,
// each reload would open a new pool until Postgres refuses connections.
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
