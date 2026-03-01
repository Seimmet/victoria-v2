
import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';

dotenv.config();

const prisma = new PrismaClient({
  datasourceUrl: process.env.DATABASE_URL,
});

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
