import "dotenv/config";
import bcrypt from "bcryptjs";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

// Demo login: demo@recall.local / recall-demo
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });

async function main() {
  const email = "demo@recall.local";
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log(`Seed already present (patient ${existing.patientId})`);
    return;
  }
  const patient = await prisma.patient.create({ data: { name: "Ruth" } });
  await prisma.user.create({
    data: {
      email,
      name: "Sarah",
      passwordHash: await bcrypt.hash("recall-demo", 12),
      emailVerifiedAt: new Date(),
      patientId: patient.id,
    },
  });
  console.log(`Seeded patient ${patient.id} and ${email}`);
}

main()
  .finally(() => prisma.$disconnect());
