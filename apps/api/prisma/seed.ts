import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const defaultCategories = [
  "Food",
  "Transport",
  "Shopping",
  "Bills",
  "Savings",
  "Savings & Investing",
  "Data & Airtime",
  "Family",
  "Entertainment",
  "Other",
];

async function main() {
  for (const name of defaultCategories) {
    await prisma.category.upsert({
      where: { name },
      update: { isSystemDefault: true },
      create: { name, isSystemDefault: true },
    });
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
