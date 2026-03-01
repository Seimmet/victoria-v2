
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import dotenv from 'dotenv';

dotenv.config();

const connectionString = `${process.env.DATABASE_URL}`;

const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);

const prisma = new PrismaClient({ adapter });

const TARGET_HOURS = {
  monday: { start: "09:00", end: "22:00", isOpen: true },
  tuesday: { start: "09:00", end: "22:00", isOpen: true },
  wednesday: { start: "09:00", end: "22:00", isOpen: true },
  thursday: { start: "09:00", end: "22:00", isOpen: true },
  friday: { start: "09:00", end: "22:00", isOpen: true },
  saturday: { start: "09:00", end: "22:00", isOpen: true },
  sunday: { start: "09:00", end: "22:00", isOpen: true },
};

async function main() {
  console.log('🚀 Starting Working Hours Update Script...');
  console.log('----------------------------------------');

  // 1. Update Global Salon Settings
  console.log('1️⃣  Updating Global Salon Settings...');
  const settings = await prisma.salonSettings.findFirst();
  
  if (settings) {
    await prisma.salonSettings.update({
      where: { id: settings.id },
      data: { businessHours: TARGET_HOURS }
    });
    console.log('   ✅ Global Salon Settings updated to 09:00 - 22:00.');
  } else {
    // Create if not exists (fallback)
    await prisma.salonSettings.create({
      data: {
        salonName: "Victoria Braids & Weaves",
        businessHours: TARGET_HOURS
      }
    });
    console.log('   ✅ Global Salon Settings created with 09:00 - 22:00.');
  }

  // 2. Update All Stylists
  console.log('\n2️⃣  Updating All Stylists...');
  const stylists = await prisma.stylist.findMany({
    include: { user: true }
  });
  
  if (stylists.length === 0) {
    console.log('   ℹ️  No stylists found to update.');
  } else {
    let updatedCount = 0;
    for (const stylist of stylists) {
      // Overwrite working hours to ensure 10pm close time
      await prisma.stylist.update({
        where: { id: stylist.id },
        data: { workingHours: TARGET_HOURS }
      });
      console.log(`   Detailed: Updated ${stylist.user.fullName}`);
      updatedCount++;
    }
    console.log(`   ✅ Successfully updated ${updatedCount} stylists to 09:00 - 22:00.`);
  }

  console.log('----------------------------------------');
  console.log('🎉 Update Complete!');
}

main()
  .catch((e) => {
    console.error('❌ Error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
