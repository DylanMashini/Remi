import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

// The Vercel Prisma Postgres integration injects DATABASE_URL as the *direct* connection
// (db.prisma.io, role prisma_migration). That endpoint allows only a handful of concurrent
// connections and is meant for `prisma migrate`, so a few warm lambdas exhaust it
// ("too many connections for role prisma_migration", P2037). Application traffic has to
// go through the pooler, which takes the same credentials on a different host.
// `prisma.config.ts` keeps using DATABASE_URL directly for migrations.
function pooledConnectionString(): string {
  const override = process.env.DATABASE_POOLED_URL;
  if (override) return override;
  const direct = process.env.DATABASE_URL;
  if (!direct) throw new Error("DATABASE_URL is not set");
  return direct.replace("@db.prisma.io:", "@pooled.db.prisma.io:");
}

// One client per process. Without the global cache, every `next dev` hot reload
// creates a new client and a new connection pool until Postgres runs out of slots.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createPrismaClient() {
  const adapter = new PrismaPg({
    connectionString: pooledConnectionString(),
    // Each serverless instance owns its own pool; keep it small so many warm instances
    // stay under the plan's pooled connection limit.
    max: 3,
  });
  return new PrismaClient({ adapter });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
