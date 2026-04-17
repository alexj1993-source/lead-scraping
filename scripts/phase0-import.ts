#!/usr/bin/env tsx
/**
 * Phase 0: Validate pipeline with existing leads before scrapers.
 *
 * Usage: pnpm run phase0:import --file=./existing-leads.csv --source=MANUAL_IMPORT
 *
 * Accepts CSV with columns: companyName, firstName, fullName, title, email,
 * websiteUrl, linkedinUrl, sourceUrl, landingPageUrl, country
 *
 * Runs each lead through the full pipeline:
 * 1. Import to DB as RAW
 * 2. Enrich (waterfall + Exa fallback)
 * 3. ICP Score (with Exa verification for borderline)
 * 4. Deduplicate
 * 5. Validate email (NeverBounce + BounceBan)
 * 6. Personalize (with Exa context + quality gates)
 * 7. Upload to Instantly test campaign
 * 8. Generate Phase 0 quality report
 */

import { createReadStream, writeFileSync } from 'fs';
import { parse } from 'csv-parse';
import { prisma, Source, LeadStatus } from '@hyperscale/database';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';

// ---------------------------------------------------------------------------
// CLI arg parsing
// ---------------------------------------------------------------------------

interface CliArgs {
  file: string;
  source: string;
  limit?: number;
  dryRun: boolean;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  const map = new Map<string, string>();
  for (const arg of args) {
    const [key, ...rest] = arg.replace(/^--/, '').split('=');
    map.set(key, rest.join('='));
  }

  const file = map.get('file');
  if (!file) {
    console.error('Usage: pnpm run phase0:import --file=./existing-leads.csv [--source=MANUAL_IMPORT] [--limit=N] [--dry-run]');
    process.exit(1);
  }

  return {
    file,
    source: map.get('source') ?? 'MANUAL_IMPORT',
    limit: map.has('limit') ? parseInt(map.get('limit')!, 10) : undefined,
    dryRun: map.has('dry-run'),
  };
}

// ---------------------------------------------------------------------------
// CSV row shape
// ---------------------------------------------------------------------------

interface CsvRow {
  companyName: string;
  firstName?: string;
  fullName?: string;
  title?: string;
  email?: string;
  websiteUrl?: string;
  linkedinUrl?: string;
  sourceUrl?: string;
  landingPageUrl?: string;
  country?: string;
}

// ---------------------------------------------------------------------------
// Progress display
// ---------------------------------------------------------------------------

const PIPELINE_STAGES = [
  'RAW',
  'ENRICHING',
  'ENRICHED',
  'SCORING',
  'SCORED_PASS',
  'DEDUPED_DUPLICATE',
  'VALIDATING',
  'VALIDATED_VALID',
  'PERSONALIZING',
  'READY_TO_UPLOAD',
  'UPLOADED',
] as const;

const TERMINAL_STATUSES = new Set<string>([
  'UPLOADED',
  'SCORED_FAIL',
  'DEDUPED_DUPLICATE',
  'VALIDATED_INVALID',
  'ESCALATED',
  'ERROR',
]);

class ProgressTracker {
  private startTime = Date.now();
  private statusCounts = new Map<string, number>();
  private total = 0;

  init(total: number) {
    this.total = total;
  }

  update(statusMap: Map<string, number>) {
    this.statusCounts = statusMap;
    this.render();
  }

  private render() {
    const elapsed = ((Date.now() - this.startTime) / 1000).toFixed(1);
    const terminal = [...this.statusCounts.entries()]
      .filter(([s]) => TERMINAL_STATUSES.has(s))
      .reduce((sum, [, c]) => sum + c, 0);
    const pct = this.total > 0 ? Math.round((terminal / this.total) * 100) : 0;

    const bar = this.buildBar(pct);

    process.stdout.write(
      `\r${bar} ${pct}% (${terminal}/${this.total}) | ${elapsed}s | ` +
        this.statusSummary(),
    );
  }

  private buildBar(pct: number): string {
    const width = 30;
    const filled = Math.round((pct / 100) * width);
    return '[' + '█'.repeat(filled) + '░'.repeat(width - filled) + ']';
  }

  private statusSummary(): string {
    const parts: string[] = [];
    for (const [status, count] of this.statusCounts) {
      if (count > 0) parts.push(`${status}:${count}`);
    }
    return parts.join(' ');
  }
}

// ---------------------------------------------------------------------------
// Cost tracking
// ---------------------------------------------------------------------------

interface CostBreakdown {
  enrichment: number;
  scoring: number;
  validation: number;
  personalization: number;
  exa: number;
  upload: number;
  total: number;
}

async function getCostBreakdown(): Promise<CostBreakdown> {
  const budgets = await prisma.budget.findMany();
  const costs: CostBreakdown = {
    enrichment: 0,
    scoring: 0,
    validation: 0,
    personalization: 0,
    exa: 0,
    upload: 0,
    total: 0,
  };

  for (const b of budgets) {
    const usage = b.currentUsageUsd;
    switch (b.provider) {
      case 'apollo':
      case 'lusha':
      case 'getprospect':
      case 'snovio':
        costs.enrichment += usage;
        break;
      case 'anthropic':
      case 'openai':
        costs.scoring += usage * 0.4;
        costs.personalization += usage * 0.6;
        break;
      case 'neverbounce':
      case 'bounceban':
        costs.validation += usage;
        break;
      case 'exa':
        costs.exa += usage;
        break;
      case 'instantly':
        costs.upload += usage;
        break;
    }
  }

  costs.total =
    costs.enrichment +
    costs.scoring +
    costs.validation +
    costs.personalization +
    costs.exa +
    costs.upload;

  return costs;
}

// ---------------------------------------------------------------------------
// Phase 0 hard cap safety check
// ---------------------------------------------------------------------------

const PHASE0_HARD_CAP_USD = 100;

async function checkBudgetCap(): Promise<boolean> {
  const costs = await getCostBreakdown();
  if (costs.total >= PHASE0_HARD_CAP_USD) {
    console.error(
      `\n\n🛑 PHASE 0 HARD CAP REACHED: $${costs.total.toFixed(2)} >= $${PHASE0_HARD_CAP_USD}`,
    );
    console.error('Pipeline halted to prevent runaway spend on first run.');
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// CSV reader
// ---------------------------------------------------------------------------

async function readCsv(filePath: string, limit?: number): Promise<CsvRow[]> {
  const rows: CsvRow[] = [];

  return new Promise((resolve, reject) => {
    const parser = createReadStream(filePath).pipe(
      parse({
        columns: true,
        skip_empty_lines: true,
        trim: true,
        relaxColumnCount: true,
      }),
    );

    parser.on('data', (row: CsvRow) => {
      if (limit && rows.length >= limit) return;
      rows.push(row);
    });
    parser.on('end', () => resolve(rows));
    parser.on('error', reject);
  });
}

// ---------------------------------------------------------------------------
// Import leads to DB
// ---------------------------------------------------------------------------

async function importLeads(
  rows: CsvRow[],
  source: string,
): Promise<string[]> {
  const leadIds: string[] = [];

  for (const row of rows) {
    if (!row.companyName) {
      console.warn('Skipping row with no companyName');
      continue;
    }

    const normalized = row.companyName.toLowerCase().replace(/\s+/g, ' ').trim();

    const existing = await prisma.lead.findFirst({
      where: {
        companyNameNormalized: normalized,
        ...(row.email ? { email: row.email } : {}),
      },
    });

    if (existing) {
      console.log(`  ⏭ Skipping duplicate: ${row.companyName}`);
      leadIds.push(existing.id);
      continue;
    }

    const lead = await prisma.lead.create({
      data: {
        companyName: row.companyName,
        companyNameNormalized: normalized,
        source: source as Source,
        sourceUrl: row.sourceUrl || row.websiteUrl || `manual://${normalized}`,
        firstName: row.firstName || undefined,
        fullName: row.fullName || undefined,
        title: row.title || undefined,
        email: row.email || undefined,
        websiteUrl: row.websiteUrl || undefined,
        linkedinUrl: row.linkedinUrl || undefined,
        landingPageUrl: row.landingPageUrl || undefined,
        country: row.country || undefined,
        status: 'RAW',
      },
    });

    leadIds.push(lead.id);
  }

  return leadIds;
}

// ---------------------------------------------------------------------------
// Queue leads through pipeline
// ---------------------------------------------------------------------------

async function queueLeadsThroughPipeline(
  leadIds: string[],
  redis: IORedis,
): Promise<void> {
  const enrichQueue = new Queue('enrich', { connection: redis });
  const dedupQueue = new Queue('dedup', { connection: redis });

  const leads = await prisma.lead.findMany({
    where: { id: { in: leadIds } },
  });

  const leadsToEnrich = leads.filter((l) => l.status === 'RAW');
  if (leadsToEnrich.length > 0) {
    const enrichPayload = leadsToEnrich.map((l) => ({
      companyName: l.companyName,
      sourceUrl: l.sourceUrl,
      source: l.source.toLowerCase() as 'facebook_ads' | 'instagram' | 'linkedin',
      firstName: l.firstName ?? undefined,
      fullName: l.fullName ?? undefined,
      title: l.title ?? undefined,
      email: l.email ?? undefined,
      websiteUrl: l.websiteUrl ?? undefined,
      linkedinUrl: l.linkedinUrl ?? undefined,
      country: l.country ?? undefined,
      landingPageUrl: l.landingPageUrl ?? undefined,
    }));

    await enrichQueue.add('enrich', { leads: enrichPayload });
    console.log(`  📤 Queued ${leadsToEnrich.length} leads for enrichment`);
  }

  await dedupQueue.add('dedup', { leadIds });
  console.log(`  📤 Queued ${leadIds.length} leads for dedup check`);

  await enrichQueue.close();
  await dedupQueue.close();
}

// ---------------------------------------------------------------------------
// Poll for pipeline completion
// ---------------------------------------------------------------------------

async function pollForCompletion(
  leadIds: string[],
  tracker: ProgressTracker,
  timeoutMs = 600_000,
): Promise<Map<string, number>> {
  const start = Date.now();
  const pollInterval = 3_000;

  while (Date.now() - start < timeoutMs) {
    const leads = await prisma.lead.findMany({
      where: { id: { in: leadIds } },
      select: { status: true },
    });

    const statusMap = new Map<string, number>();
    for (const l of leads) {
      statusMap.set(l.status, (statusMap.get(l.status) ?? 0) + 1);
    }

    tracker.update(statusMap);

    const terminalCount = [...statusMap.entries()]
      .filter(([s]) => TERMINAL_STATUSES.has(s))
      .reduce((sum, [, c]) => sum + c, 0);

    if (terminalCount >= leadIds.length) {
      console.log('\n');
      return statusMap;
    }

    const withinBudget = await checkBudgetCap();
    if (!withinBudget) {
      console.log('\n');
      return statusMap;
    }

    await sleep(pollInterval);
  }

  console.warn('\n⚠️  Pipeline timeout reached. Some leads may still be processing.');
  const leads = await prisma.lead.findMany({
    where: { id: { in: leadIds } },
    select: { status: true },
  });
  const finalMap = new Map<string, number>();
  for (const l of leads) {
    finalMap.set(l.status, (finalMap.get(l.status) ?? 0) + 1);
  }
  return finalMap;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// Quality report generation
// ---------------------------------------------------------------------------

interface Phase0Report {
  timestamp: string;
  totalInput: number;
  statusBreakdown: Record<string, number>;
  enriched: { standard: number; exaFallback: number; total: number };
  icpPass: number;
  icpFail: number;
  duplicatesDetected: number;
  validationValid: number;
  validationInvalid: number;
  personalizationPassed: number;
  uploaded: number;
  costs: CostBreakdown;
  remediationEvents: number;
  tier3Escalations: number;
  acceptanceCriteria: Record<string, { target: string; actual: string; pass: boolean }>;
}

async function generateReport(
  leadIds: string[],
  statusMap: Map<string, number>,
): Promise<Phase0Report> {
  const leads = await prisma.lead.findMany({
    where: { id: { in: leadIds } },
    include: { remediations: true },
  });

  const costs = await getCostBreakdown();

  const enrichedLeads = leads.filter((l) => l.email);
  const exaFallbackCount = leads.filter(
    (l) => l.exaContext && typeof l.exaContext === 'object',
  ).length;

  const remediationEvents = leads.reduce(
    (sum, l) => sum + l.remediations.length,
    0,
  );
  const tier3Escalations = leads.reduce(
    (sum, l) =>
      sum + l.remediations.filter((r) => r.status === 'ESCALATED').length,
    0,
  );

  const totalInput = leadIds.length;
  const enrichedCount = enrichedLeads.length;
  const icpPass = statusMap.get('SCORED_PASS') ?? 0;
  const icpPassOnward =
    icpPass +
    (statusMap.get('VALIDATING') ?? 0) +
    (statusMap.get('VALIDATED_VALID') ?? 0) +
    (statusMap.get('PERSONALIZING') ?? 0) +
    (statusMap.get('READY_TO_UPLOAD') ?? 0) +
    (statusMap.get('UPLOADED') ?? 0);
  const icpFail = statusMap.get('SCORED_FAIL') ?? 0;
  const dupes = statusMap.get('DEDUPED_DUPLICATE') ?? 0;
  const validValid = statusMap.get('VALIDATED_VALID') ?? 0;
  const validInvalid = statusMap.get('VALIDATED_INVALID') ?? 0;
  const personalized =
    (statusMap.get('READY_TO_UPLOAD') ?? 0) + (statusMap.get('UPLOADED') ?? 0);
  const uploaded = statusMap.get('UPLOADED') ?? 0;

  const enrichRate = totalInput > 0 ? enrichedCount / totalInput : 0;
  const icpPassRate = enrichedCount > 0 ? icpPassOnward / enrichedCount : 0;
  const validRate =
    icpPassOnward > 0
      ? (validValid + personalized + uploaded) / icpPassOnward
      : 0;
  const uploadRate = totalInput > 0 ? uploaded / totalInput : 0;

  const acceptanceCriteria: Record<
    string,
    { target: string; actual: string; pass: boolean }
  > = {
    'Enrichment rate': {
      target: '>=70%',
      actual: `${(enrichRate * 100).toFixed(1)}%`,
      pass: enrichRate >= 0.7,
    },
    'ICP pass rate': {
      target: '>=40%',
      actual: `${(icpPassRate * 100).toFixed(1)}%`,
      pass: icpPassRate >= 0.4,
    },
    'Email validation rate': {
      target: '>=80%',
      actual: `${(validRate * 100).toFixed(1)}%`,
      pass: validRate >= 0.8,
    },
    'End-to-end upload rate': {
      target: '>=20%',
      actual: `${(uploadRate * 100).toFixed(1)}%`,
      pass: uploadRate >= 0.2,
    },
    'Total cost under cap': {
      target: `<=$${PHASE0_HARD_CAP_USD}`,
      actual: `$${costs.total.toFixed(2)}`,
      pass: costs.total <= PHASE0_HARD_CAP_USD,
    },
  };

  return {
    timestamp: new Date().toISOString(),
    totalInput,
    statusBreakdown: Object.fromEntries(statusMap),
    enriched: {
      standard: enrichedCount - exaFallbackCount,
      exaFallback: exaFallbackCount,
      total: enrichedCount,
    },
    icpPass: icpPassOnward,
    icpFail,
    duplicatesDetected: dupes,
    validationValid: validValid,
    validationInvalid: validInvalid,
    personalizationPassed: personalized,
    uploaded,
    costs,
    remediationEvents,
    tier3Escalations,
    acceptanceCriteria,
  };
}

function renderReport(report: Phase0Report): string {
  const lines: string[] = [];
  const hr = '─'.repeat(60);

  lines.push('# Phase 0 Quality Report');
  lines.push(`Generated: ${report.timestamp}`);
  lines.push('');
  lines.push(`## Pipeline Summary`);
  lines.push('');
  lines.push(`| Metric | Count |`);
  lines.push(`|--------|-------|`);
  lines.push(`| Total input | ${report.totalInput} |`);
  lines.push(
    `| Enriched (standard) | ${report.enriched.standard} |`,
  );
  lines.push(
    `| Enriched (Exa fallback) | ${report.enriched.exaFallback} |`,
  );
  lines.push(`| Enriched total | ${report.enriched.total} |`);
  lines.push(`| ICP pass | ${report.icpPass} |`);
  lines.push(`| ICP fail | ${report.icpFail} |`);
  lines.push(`| Duplicates detected | ${report.duplicatesDetected} |`);
  lines.push(`| Validation valid | ${report.validationValid} |`);
  lines.push(`| Validation invalid | ${report.validationInvalid} |`);
  lines.push(`| Personalization passed | ${report.personalizationPassed} |`);
  lines.push(`| Uploaded | ${report.uploaded} |`);
  lines.push(`| Remediation events | ${report.remediationEvents} |`);
  lines.push(`| Tier 3 escalations | ${report.tier3Escalations} |`);
  lines.push('');
  lines.push(`## Status Breakdown`);
  lines.push('');
  for (const [status, count] of Object.entries(report.statusBreakdown)) {
    lines.push(`- **${status}**: ${count}`);
  }
  lines.push('');
  lines.push(`## Cost Breakdown`);
  lines.push('');
  lines.push(`| Provider Category | Cost |`);
  lines.push(`|-------------------|------|`);
  lines.push(`| Enrichment | $${report.costs.enrichment.toFixed(2)} |`);
  lines.push(`| Scoring (LLM) | $${report.costs.scoring.toFixed(2)} |`);
  lines.push(`| Validation | $${report.costs.validation.toFixed(2)} |`);
  lines.push(`| Personalization (LLM) | $${report.costs.personalization.toFixed(2)} |`);
  lines.push(`| Exa | $${report.costs.exa.toFixed(2)} |`);
  lines.push(`| Upload (Instantly) | $${report.costs.upload.toFixed(2)} |`);
  lines.push(`| **Total** | **$${report.costs.total.toFixed(2)}** |`);
  lines.push('');
  lines.push(`## Acceptance Criteria`);
  lines.push('');
  lines.push(`| Criteria | Target | Actual | Pass |`);
  lines.push(`|----------|--------|--------|------|`);
  for (const [name, c] of Object.entries(report.acceptanceCriteria)) {
    const icon = c.pass ? '✅' : '❌';
    lines.push(`| ${name} | ${c.target} | ${c.actual} | ${icon} |`);
  }
  lines.push('');

  const allPass = Object.values(report.acceptanceCriteria).every(
    (c) => c.pass,
  );
  if (allPass) {
    lines.push(`## ✅ PHASE 0 PASSED — Pipeline validated, ready for scraper integration.`);
  } else {
    lines.push(`## ❌ PHASE 0 FAILED — Review criteria above before proceeding.`);
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('=== Phase 0: Pipeline Validation Import ===\n');

  const args = parseArgs();

  console.log(`File:   ${args.file}`);
  console.log(`Source: ${args.source}`);
  if (args.limit) console.log(`Limit:  ${args.limit}`);
  if (args.dryRun) console.log('Mode:   DRY RUN (no queuing)');
  console.log('');

  // Budget safety check before starting
  const budgetOk = await checkBudgetCap();
  if (!budgetOk) {
    process.exit(1);
  }

  // Read CSV
  console.log('[1/5] Reading CSV...');
  const rows = await readCsv(args.file, args.limit);
  console.log(`  Found ${rows.length} rows\n`);

  if (rows.length === 0) {
    console.error('No rows found in CSV. Check file format and columns.');
    process.exit(1);
  }

  // Import leads
  console.log('[2/5] Importing leads to database...');
  const leadIds = await importLeads(rows, args.source);
  console.log(`  Imported ${leadIds.length} leads\n`);

  if (args.dryRun) {
    console.log('DRY RUN complete. Leads imported but not queued.');
    await prisma.$disconnect();
    return;
  }

  // Connect Redis + queue leads
  console.log('[3/5] Queuing leads through pipeline...');
  const redis = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
    maxRetriesPerRequest: null,
  });

  await queueLeadsThroughPipeline(leadIds, redis);
  console.log('');

  // Poll for completion
  console.log('[4/5] Waiting for pipeline completion...\n');
  const tracker = new ProgressTracker();
  tracker.init(leadIds.length);
  const finalStatus = await pollForCompletion(leadIds, tracker);

  // Generate report
  console.log('[5/5] Generating quality report...\n');
  const report = await generateReport(leadIds, finalStatus);
  const reportText = renderReport(report);

  console.log(reportText);

  // Save report
  const reportPath = 'PHASE_0_REPORT.md';
  writeFileSync(reportPath, reportText, 'utf-8');
  console.log(`\nReport saved to ${reportPath}`);

  // Also dump JSON for programmatic access
  writeFileSync(
    'PHASE_0_REPORT.json',
    JSON.stringify(report, null, 2),
    'utf-8',
  );

  await redis.quit();
  await prisma.$disconnect();

  const allPass = Object.values(report.acceptanceCriteria).every(
    (c) => c.pass,
  );
  process.exit(allPass ? 0 : 1);
}

main().catch((err) => {
  console.error('Phase 0 import failed:', err);
  prisma.$disconnect();
  process.exit(1);
});
