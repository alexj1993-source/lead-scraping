import { PrismaClient, Source, SourceTier } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // --- SourceConfig entries ---
  const sourceConfigs = [
    { source: Source.FACEBOOK_ADS, activeTier: SourceTier.TIER_2_MANAGED },
    { source: Source.INSTAGRAM, activeTier: SourceTier.TIER_3_INHOUSE },
  ] as const;

  for (const cfg of sourceConfigs) {
    await prisma.sourceConfig.upsert({
      where: { source: cfg.source },
      update: { activeTier: cfg.activeTier },
      create: cfg,
    });
  }
  console.log('Seeded SourceConfig entries');

  // --- Campaigns ---
  const campaigns = [
    { name: 'Facebook Ads - Main', source: Source.FACEBOOK_ADS },
    { name: 'Instagram - Main', source: Source.INSTAGRAM },
  ];

  for (const campaign of campaigns) {
    const existing = await prisma.campaign.findFirst({
      where: { name: campaign.name },
    });
    if (!existing) {
      await prisma.campaign.create({ data: campaign });
    }
  }
  console.log('Seeded Campaign entries');

  // --- Budgets ---
  const monthResetAt = new Date();
  monthResetAt.setMonth(monthResetAt.getMonth() + 1);
  monthResetAt.setDate(1);
  monthResetAt.setHours(0, 0, 0, 0);

  const budgets = [
    { provider: 'apify', monthlyCapUsd: 150 },
    { provider: 'phantombuster', monthlyCapUsd: 69 },
    { provider: 'openai', monthlyCapUsd: 200 },
    { provider: 'anthropic', monthlyCapUsd: 200 },
    { provider: 'exa', monthlyCapUsd: 100 },
    { provider: 'neverbounce', monthlyCapUsd: 50 },
    { provider: 'bounceban', monthlyCapUsd: 50 },
    { provider: 'instantly', monthlyCapUsd: 97 },
    { provider: 'scrapeowl', monthlyCapUsd: 30 },
  ];

  for (const budget of budgets) {
    await prisma.budget.upsert({
      where: { provider: budget.provider },
      update: { monthlyCapUsd: budget.monthlyCapUsd },
      create: { ...budget, monthResetAt },
    });
  }
  console.log('Seeded Budget entries');

  // --- Keywords ---
  const keywords: { primary: string; source: Source }[] = [
    // Facebook Ads: primary keyword is what you search in Ad Library
    { primary: 'real estate coach', source: Source.FACEBOOK_ADS },
    { primary: 'fitness coach', source: Source.FACEBOOK_ADS },
    { primary: 'dating coach', source: Source.FACEBOOK_ADS },
    { primary: 'health coach', source: Source.FACEBOOK_ADS },
    { primary: 'life coach', source: Source.FACEBOOK_ADS },
    { primary: 'business coach', source: Source.FACEBOOK_ADS },
    { primary: 'mindset coach', source: Source.FACEBOOK_ADS },
    { primary: 'relationship coach', source: Source.FACEBOOK_ADS },
    { primary: 'career coach', source: Source.FACEBOOK_ADS },
    { primary: 'leadership coach', source: Source.FACEBOOK_ADS },
    { primary: 'executive coach', source: Source.FACEBOOK_ADS },
    { primary: 'sales coach', source: Source.FACEBOOK_ADS },
    { primary: 'marketing coach', source: Source.FACEBOOK_ADS },
    { primary: 'money coach', source: Source.FACEBOOK_ADS },
    { primary: 'wealth coach', source: Source.FACEBOOK_ADS },
    { primary: 'spirituality coach', source: Source.FACEBOOK_ADS },
    { primary: 'parenting coach', source: Source.FACEBOOK_ADS },
    { primary: 'nutrition coach', source: Source.FACEBOOK_ADS },
    { primary: 'weight loss coach', source: Source.FACEBOOK_ADS },
    { primary: 'wellness coach', source: Source.FACEBOOK_ADS },
    { primary: 'yoga coach', source: Source.FACEBOOK_ADS },
    { primary: 'meditation coach', source: Source.FACEBOOK_ADS },
    { primary: 'manifestation coach', source: Source.FACEBOOK_ADS },
    { primary: 'Amazon FBA coach', source: Source.FACEBOOK_ADS },
    { primary: 'Airbnb coach', source: Source.FACEBOOK_ADS },
    { primary: 'ecommerce coach', source: Source.FACEBOOK_ADS },
    { primary: 'dropshipping coach', source: Source.FACEBOOK_ADS },
    { primary: 'SMMA coach', source: Source.FACEBOOK_ADS },
    { primary: 'copywriting coach', source: Source.FACEBOOK_ADS },
    { primary: 'high-ticket coach', source: Source.FACEBOOK_ADS },
    { primary: 'speaking coach', source: Source.FACEBOOK_ADS },
    { primary: 'author coach', source: Source.FACEBOOK_ADS },
    { primary: 'publishing coach', source: Source.FACEBOOK_ADS },
    // Instagram: primary keyword combined with "coach" at search time
    { primary: 'real estate', source: Source.INSTAGRAM },
    { primary: 'fitness', source: Source.INSTAGRAM },
    { primary: 'dating', source: Source.INSTAGRAM },
    { primary: 'health', source: Source.INSTAGRAM },
    { primary: 'life', source: Source.INSTAGRAM },
    { primary: 'business', source: Source.INSTAGRAM },
    { primary: 'mindset', source: Source.INSTAGRAM },
    { primary: 'relationship', source: Source.INSTAGRAM },
    { primary: 'career', source: Source.INSTAGRAM },
    { primary: 'leadership', source: Source.INSTAGRAM },
    { primary: 'executive', source: Source.INSTAGRAM },
    { primary: 'sales', source: Source.INSTAGRAM },
    { primary: 'marketing', source: Source.INSTAGRAM },
    { primary: 'wellness', source: Source.INSTAGRAM },
    { primary: 'yoga', source: Source.INSTAGRAM },
    { primary: 'nutrition', source: Source.INSTAGRAM },
  ];

  for (const kw of keywords) {
    const existing = await prisma.keyword.findFirst({
      where: { primary: kw.primary, source: kw.source },
    });
    if (!existing) {
      await prisma.keyword.create({ data: kw });
    }
  }
  console.log(`Seeded ${keywords.length} Keyword entries`);
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    prisma.$disconnect();
    process.exit(1);
  });
