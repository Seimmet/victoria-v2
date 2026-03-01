
import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';

dotenv.config();

const prisma = new PrismaClient({
  datasourceUrl: process.env.DATABASE_URL,
});

async function main() {
  const categories = await prisma.category.findMany({ take: 5 });
  console.log('Categories:', categories);

  const styles = await prisma.style.findMany({ take: 5 });
  console.log('Styles:', styles);
}

main()
  .catch(e => console.error(e))
  .finally(async () => {
    await prisma.$disconnect();
  });
