
import { PrismaClient } from '@prisma/client';
import * as XLSX from 'xlsx';
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
  // Path to the Excel file
  const filePath = path.join(__dirname, '../pricing_data.xlsx');
  
  console.log(`Reading file from: ${filePath}`);
  
  if (!require('fs').existsSync(filePath)) {
      console.error('File not found! Please ensure pricing_data.xlsx exists in the backend folder.');
      process.exit(1);
  }

  try {
    const workbook = XLSX.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    
    // Convert to JSON
    // We assume the first row contains headers. 
    // If your headers are "StyleId", "CategoryId", "Price", "Time"
    const data = XLSX.utils.sheet_to_json(sheet);
    
    console.log(`Found ${data.length} records. Processing...`);

    let successCount = 0;
    let errorCount = 0;

    for (const row of data as any[]) {
        // Normalize keys (handle case sensitivity or variations)
        let styleId = row['StyleId'] || row['styleId'] || row['Style ID'];
        let categoryId = row['CategoryId'] || row['categoryId'] || row['Category ID'];
        const styleName = row['Style Name'] || row['styleName'] || row['Style'] || row['Service Name']; // Added Service Name for compatibility
        const categoryName = row['Category Name'] || row['categoryName'] || row['Category'] || row['Variation'];
        
        const price = row['Price'] || row['price'];
        // "Time" column is in hours, need to convert to minutes
        const timeHours = row['Time'] || row['time'] || row['Duration'] || row['Hours'];

        // If IDs are missing but Names are provided, lookup IDs
        if ((!styleId && styleName) || (!categoryId && categoryName)) {
            try {
                if (!styleId && styleName) {
                    const style = await prisma.style.findFirst({
                        where: { name: { equals: styleName, mode: 'insensitive' } }
                    });
                    if (style) styleId = style.id;
                    else console.warn(`Style not found: ${styleName}`);
                }

                if (!categoryId && categoryName) {
                    const category = await prisma.category.findFirst({
                        where: { name: { equals: categoryName, mode: 'insensitive' } }
                    });
                    if (category) categoryId = category.id;
                    else console.warn(`Category not found: ${categoryName}`);
                }
            } catch (lookupError) {
                console.error('Error looking up IDs:', lookupError);
            }
        }

        if (!styleId || !categoryId || !price || timeHours === undefined) {
            console.warn(`Skipping row due to missing data: Style=${styleId || styleName}, Category=${categoryId || categoryName}, Price=${price}`);
            errorCount++;
            continue;
        }

        try {
            // Convert hours to minutes
            // e.g. 1.5 hours -> 90 minutes
            const durationMinutes = Math.round(parseFloat(timeHours) * 60);
            
            await prisma.stylePricing.upsert({
                where: {
                    styleId_categoryId: {
                        styleId: styleId.toString().trim(),
                        categoryId: categoryId.toString().trim()
                    }
                },
                update: {
                    price: parseFloat(price),
                    durationMinutes: durationMinutes
                },
                create: {
                    styleId: styleId.toString().trim(),
                    categoryId: categoryId.toString().trim(),
                    price: parseFloat(price),
                    durationMinutes: durationMinutes
                }
            });
            successCount++;
        } catch (err) {
            console.error(`Failed to upsert for Style ${styleId} / Category ${categoryId}:`, err);
            errorCount++;
        }
    }
    
    console.log('Seeding completed.');
    console.log(`Successfully processed: ${successCount}`);
    console.log(`Errors/Skipped: ${errorCount}`);

  } catch (error) {
    console.error('Error reading or processing file:', error);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
