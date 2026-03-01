import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import dotenv from 'dotenv';

dotenv.config();

const connectionString = `${process.env.DATABASE_URL}`;

const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);

const prisma = new PrismaClient({ adapter });

async function main() {
  const seedDataPath = path.join(__dirname, 'seed-data.json');
  
  if (fs.existsSync(seedDataPath)) {
    console.log('Found seed-data.json. Checking if database needs population...');
    const data = JSON.parse(fs.readFileSync(seedDataPath, 'utf-8'));
    
    // Helper to restore table if empty
    const restoreIfEmpty = async (modelName: string, modelData: any[]) => {
      // @ts-ignore
      if (!prisma[modelName]) {
        console.log(`Skipping ${modelName} (Model not found in Prisma Client)`);
        return;
      }

      // @ts-ignore
      const count = await prisma[modelName].count();
      if (count === 0 && modelData && modelData.length > 0) {
        console.log(`Restoring ${modelName} (${modelData.length} records)...`);
        
        // Fix for Category isActive issue
        let finalData = modelData;
        if (modelName === 'category') {
             finalData = modelData.map((item: any) => {
                const { isActive, ...rest } = item;
                return rest;
             });
        }

        // @ts-ignore
        await prisma[modelName].createMany({ 
          data: finalData,
          skipDuplicates: true 
        });
      } else {
        console.log(`Skipping ${modelName} (Table has ${count} records or no data to restore)`);
      }
    };

    // Restore in dependency order
    await restoreIfEmpty('user', data.users);
    await restoreIfEmpty('category', data.categories);
    await restoreIfEmpty('style', data.services); // service -> style
    await restoreIfEmpty('salonSettings', data.salonSettings);
    await restoreIfEmpty('chatbotKnowledge', data.chatbotKnowledge);

    await restoreIfEmpty('stylist', data.stylists);
    
    // stylistPricing removed, maybe restore stylePricing if available
    // await restoreIfEmpty('stylePricing', data.stylePricing); 
    
    await restoreIfEmpty('availability', data.availability);
    
    await restoreIfEmpty('booking', data.bookings);
    await restoreIfEmpty('payment', data.payments);
    await restoreIfEmpty('notification', data.notifications);

    console.log('Database population from backup completed.');
    
  } else {
    console.log('No seed-data.json found. Running default seed logic...');
    await defaultSeed();
  }
}

async function defaultSeed() {
  console.log('Default seed logic is currently disabled due to schema changes.');
  console.log('Please use the admin dashboard or specific scripts to seed data.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
