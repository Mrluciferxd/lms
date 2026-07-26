/**
 * Prisma client singleton.
 *
 * Prisma 7 requires an explicit driver adapter — the connection URL no longer
 * lives in schema.prisma.
 *
 * Initialisation is LAZY, behind a proxy. Constructing the client at import time
 * meant that importing anything which transitively reached this module required a
 * live DATABASE_URL — including modules where the code under test was pure. That
 * couples unit tests and scripts to database configuration for no reason. With the
 * proxy, `import { db }` costs nothing and the pool opens on first actual query.
 *
 * The `globalThis` cache prevents Next's dev-mode module reloading from opening a
 * new pool on every hot reload, which otherwise exhausts Postgres connection
 * slots within a few minutes of editing.
 */

import { PrismaPg } from '@prisma/adapter-pg'

import { PrismaClient } from '@/generated/prisma/client'

function createClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set. Copy .env.example to .env.')
  }

  return new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  })
}

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

function getClient(): PrismaClient {
  if (!globalForPrisma.prisma) {
    globalForPrisma.prisma = createClient()
  }
  return globalForPrisma.prisma
}

export const db: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, property) {
    const client = getClient()
    const value = client[property as keyof PrismaClient]
    // Bind top-level methods ($transaction, $disconnect) so `this` stays the
    // client rather than the proxy. Model delegates are objects and need no
    // rebinding — their own methods are already bound internally.
    return typeof value === 'function' ? (value as (...args: never[]) => unknown).bind(client) : value
  },
  has(_target, property) {
    return property in getClient()
  },
})

/** Closes the pool. For scripts; the server keeps its pool for its lifetime. */
export async function disconnectDb(): Promise<void> {
  if (globalForPrisma.prisma) {
    await globalForPrisma.prisma.$disconnect()
    globalForPrisma.prisma = undefined
  }
}
