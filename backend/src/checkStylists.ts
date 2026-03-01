
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import dotenv from 'dotenv';

dotenv.config();

const connectionString = `${process.env.DATABASE_URL}`;

const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);

const prisma = new PrismaClient({ adapter });

async function checkData() {
  try {
    const activeStylists = await prisma.stylist.count({
      where: { isActive: true }
    });
    console.log(`Active Stylists: ${activeStylists}`);

    const allStylists = await prisma.stylist.findMany();
    console.log('All Stylists:', allStylists);

  } catch (error) {
    console.error('Error checking data:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkData();
