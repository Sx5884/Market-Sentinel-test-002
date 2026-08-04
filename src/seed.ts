import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding initial data...');

  // 1. Create Default Categories
  const macro = await prisma.category.upsert({
    where: { name: 'Macro' },
    update: {},
    create: { name: 'Macro' },
  });

  const regulatory = await prisma.category.upsert({
    where: { name: 'Regulatory' },
    update: {},
    create: { name: 'Regulatory' },
  });

  const corporate = await prisma.category.upsert({
    where: { name: 'Corporate' },
    update: {},
    create: { name: 'Corporate' },
  });

  const tech = await prisma.category.upsert({
    where: { name: 'Tech' },
    update: {},
    create: { name: 'Tech' },
  });

  // 2. Create Default Keyword Groups & Keywords
  const cryptoGroup = await prisma.keywordGroup.upsert({
    where: { name: 'Crypto' },
    update: {},
    create: { name: 'Crypto' },
  });

  await prisma.keyword.upsert({
    where: { term: 'bitcoin' },
    update: {},
    create: { term: 'bitcoin', keywordGroupId: cryptoGroup.id },
  });

  await prisma.keyword.upsert({
    where: { term: 'ethereum' },
    update: {},
    create: { term: 'ethereum', keywordGroupId: cryptoGroup.id },
  });

  const aiGroup = await prisma.keywordGroup.upsert({
    where: { name: 'AI' },
    update: {},
    create: { name: 'AI' },
  });

  await prisma.keyword.upsert({
    where: { term: 'nvidia' },
    update: {},
    create: { term: 'nvidia', keywordGroupId: aiGroup.id },
  });

  await prisma.keyword.upsert({
    where: { term: 'llm' },
    update: {},
    create: { term: 'llm', keywordGroupId: aiGroup.id },
  });

  // 3. Create Default Live RSS Sources
  await prisma.source.createMany({
    skipDuplicates: true,
    data: [
      {
        name: 'White House Briefings',
        type: 'rss',
        url: 'https://www.whitehouse.gov/briefing-room/feed/',
        categoryId: macro.id,
        checkIntervalSec: 300,
        status: 'active',
      },
      {
        name: 'SEC EDGAR Filings',
        type: 'rss',
        url: 'https://www.sec.gov/news/pressreleases.rss',
        categoryId: regulatory.id,
        checkIntervalSec: 300,
        status: 'active',
      },
      {
        name: 'Reuters World News',
        type: 'rss',
        url: 'https://www.reutersagency.com/feed/?best-topics=world-news',
        categoryId: macro.id,
        checkIntervalSec: 600,
        status: 'active',
      },
      {
        name: 'RBI Press Releases',
        type: 'rss',
        url: 'https://rbi.org.in/rss/rss_pressreleases.xml',
        categoryId: regulatory.id,
        checkIntervalSec: 600,
        status: 'active',
      },
    ],
  });

  // 4. Create Global Settings Singleton
  await prisma.settings.upsert({
    where: { id: 1 },
    update: {},
    create: {
      id: 1,
      telegramEnabled: false,
      emailEnabled: false,
    },
  });

  console.log('Seeding completed successfully!');
}

main()
  .catch((e) => {
    console.error('Seeding error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });