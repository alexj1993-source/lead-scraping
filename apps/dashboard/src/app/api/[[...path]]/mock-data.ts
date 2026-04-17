const now = new Date().toISOString();
const today = new Date().toISOString().split('T')[0];

const MOCK_LEADS = Array.from({ length: 24 }, (_, i) => ({
  id: `lead-${i + 1}`,
  company: ['CoachPro Academy', 'MindShift Coaching', 'ScaleUp Mentors', 'LaunchPad Courses', 'PeakFlow Training',
    'GrowthLab Co', 'Elevate Coaching', 'MasterMind Hub', 'Thrive Academy', 'NextLevel Ed',
    'CorePath Coaching', 'BrightStart Academy', 'ZenithCoach Pro', 'Catalyst Learning', 'Impact Coaching',
    'Summit Training Co', 'Apex Academy', 'VisionQuest Ed', 'BreakFree Coaching', 'FlowState Lab',
    'Pinnacle Mentors', 'IgniteCoach', 'EdgeCoaching Pro', 'TransformU Academy'][i],
  contact: ['Sarah Mitchell', 'James Rivera', 'Emily Watson', 'Marcus Chen', 'Lisa Thompson',
    'David Park', 'Rachel Green', 'Tom Anderson', 'Nina Patel', 'Chris Moore',
    'Amanda Liu', 'Kevin Brooks', 'Sophie Turner', 'Alex Kim', 'Maria Santos',
    'Ryan O\'Brien', 'Jessica Wu', 'Daniel Brown', 'Kelly Adams', 'Steve Martin',
    'Laura Chen', 'Mike Johnson', 'Ana Rodriguez', 'Ben Taylor'][i],
  email: `lead${i + 1}@example.com`,
  source: i % 3 === 0 ? 'Instagram' : 'Facebook Ads',
  score: Math.floor(60 + Math.random() * 40),
  status: ['New', 'Enriched', 'Scored', 'Validated', 'Uploaded', 'Sent', 'Replied', 'Booked'][i % 8],
  date: new Date(Date.now() - i * 3600_000 * 4).toLocaleDateString(),
}));

const MOCK_KEYWORDS = [
  { id: 'kw-1', keyword: 'business coach', source: 'FACEBOOK_ADS', score: 92, totalYield: 187, icpPassRate: 34, bookingYield: 3.2, enabled: true },
  { id: 'kw-2', keyword: 'life coach training', source: 'FACEBOOK_ADS', score: 88, totalYield: 156, icpPassRate: 28, bookingYield: 2.8, enabled: true },
  { id: 'kw-3', keyword: 'coaching certification', source: 'FACEBOOK_ADS', score: 85, totalYield: 143, icpPassRate: 31, bookingYield: 2.5, enabled: true },
  { id: 'kw-4', keyword: 'online course creator', source: 'INSTAGRAM', score: 82, totalYield: 98, icpPassRate: 26, bookingYield: 2.1, enabled: true },
  { id: 'kw-5', keyword: 'executive coaching', source: 'FACEBOOK_ADS', score: 79, totalYield: 112, icpPassRate: 22, bookingYield: 1.9, enabled: true },
  { id: 'kw-6', keyword: 'mindset coach', source: 'INSTAGRAM', score: 76, totalYield: 89, icpPassRate: 20, bookingYield: 1.7, enabled: true },
  { id: 'kw-7', keyword: 'health coach certification', source: 'FACEBOOK_ADS', score: 73, totalYield: 76, icpPassRate: 18, bookingYield: 1.4, enabled: false },
  { id: 'kw-8', keyword: 'leadership coaching', source: 'FACEBOOK_ADS', score: 71, totalYield: 67, icpPassRate: 15, bookingYield: 1.2, enabled: true },
  { id: 'kw-9', keyword: 'fitness coach online', source: 'INSTAGRAM', score: 68, totalYield: 54, icpPassRate: 12, bookingYield: 0.9, enabled: true },
  { id: 'kw-10', keyword: 'coaching program launch', source: 'FACEBOOK_ADS', score: 65, totalYield: 45, icpPassRate: 10, bookingYield: 0.7, enabled: false },
];

export const MOCK_RESPONSES: Record<string, unknown> = {
  '/api/health/overview': {
    indicators: [
      { label: 'Pipeline', status: 'green', detail: 'All stages operational' },
      { label: 'Budget', status: 'green', detail: '$12.40 / $50 daily' },
      { label: 'Deliverability', status: 'yellow', detail: '1 domain degraded' },
      { label: 'Sessions', status: 'green', detail: '4/4 active' },
    ],
    latestPaperclipAction: {
      action: 'Rotated keyword "business coach" to position #1',
      reasoning: 'Highest ICP pass rate (34%) in last 7 days with 3.2% booking yield',
      timestamp: new Date(Date.now() - 1200_000).toLocaleString(),
    },
  },

  '/api/health': { status: 'ok' },

  '/api/stats/today': {
    channels: [
      { label: 'Facebook Ads', value: 187, target: 300, cost: '$8.20', cpl: '$0.044', replies: 12, booked: 3 },
      { label: 'Instagram', value: 98, target: 200, cost: '$4.20', cpl: '$0.043', replies: 6, booked: 1 },
    ],
  },

  '/api/leads': MOCK_LEADS,

  '/api/keywords': { keywords: MOCK_KEYWORDS, proposed: [
    { keyword: 'career coach for women', source: 'FACEBOOK_ADS', estimatedYield: 45, reasoning: 'Growing niche with 28% monthly search increase. Similar keywords show 25%+ ICP pass rate.' },
  ]},

  '/api/campaigns': [
    { id: 'camp-1', name: 'FB Ads — Coaching', active: true, dailyCap: 300, todaySends: 187, replyRate: 4.2, bookingRate: 1.8,
      sequences: [
        { step: 1, subject: 'Hey {{firstName}}', delay: 'Day 0' },
        { step: 2, subject: 'Quick follow up', delay: 'Day 2' },
        { step: 3, subject: 'One more thing...', delay: 'Day 5' },
        { step: 4, subject: 'Last try', delay: 'Day 9' },
        { step: 5, subject: 'Closing the loop', delay: 'Day 14' },
      ]},
    { id: 'camp-2', name: 'IG — Coaching', active: true, dailyCap: 200, todaySends: 98, replyRate: 3.8, bookingRate: 1.5,
      sequences: [
        { step: 1, subject: 'Hey {{firstName}}', delay: 'Day 0' },
        { step: 2, subject: 'Quick follow up', delay: 'Day 2' },
        { step: 3, subject: 'Last chance', delay: 'Day 5' },
      ]},
  ],

  '/api/sources': [
    { source: 'FACEBOOK_ADS', enabled: true, activeTier: 'TIER_2_MANAGED', autoTierSwitch: true, scheduleEnabled: true, scheduleDailyTarget: 150, totalYield: 1240, keywordCount: 7,
      keywords: MOCK_KEYWORDS.filter(k => k.source === 'FACEBOOK_ADS').map(k => ({ ...k, labels: [] })),
      tierHealth: { status: 'healthy', latency: 450 } },
    { source: 'INSTAGRAM', enabled: true, activeTier: 'TIER_3_INHOUSE', autoTierSwitch: false, scheduleEnabled: false, scheduleDailyTarget: 100, totalYield: 680, keywordCount: 3,
      keywords: MOCK_KEYWORDS.filter(k => k.source === 'INSTAGRAM').map(k => ({ ...k, labels: [] })),
      tierHealth: { status: 'healthy', latency: 2100 } },
  ],

  '/api/budgets': {
    providers: [
      { name: 'NeverBounce', used: 18.40, cap: 50, remaining: 31.60, daysUntilReset: 14, currency: '$' },
      { name: 'BounceBan', used: 12.75, cap: 40, remaining: 27.25, daysUntilReset: 14, currency: '$' },
      { name: 'Anthropic (Claude)', used: 8.90, cap: 30, remaining: 21.10, daysUntilReset: 14, currency: '$' },
      { name: 'Exa Search', used: 5.20, cap: 25, remaining: 19.80, daysUntilReset: 14, currency: '$' },
      { name: 'Instantly', used: 0, cap: 97, remaining: 97, daysUntilReset: 14, currency: '$' },
      { name: 'Apollo.io', used: 3.10, cap: 20, remaining: 16.90, daysUntilReset: 14, currency: '$' },
    ],
    recommendations: [
      { title: 'Reduce Exa fallback calls', reasoning: 'Primary enrichment providers succeeding 89% of the time — Exa spend can be cut 30%.' },
    ],
  },

  '/api/replies': [
    { id: 'r-1', from: 'Sarah Mitchell', company: 'CoachPro Academy', email: 'sarah@coachpro.com',
      classification: 'POSITIVE', preview: 'This looks great! I\'d love to learn more about what you offer.', date: '2 hours ago',
      fullThread: ['Sarah: This looks great! I\'d love to learn more about what you offer.'],
      suggestedResponse: 'Hi Sarah, great to hear! Here\'s a link to book a strategy session: calendly.com/shaul-hyperscalelabs/strategysession' },
    { id: 'r-2', from: 'James Rivera', company: 'MindShift Coaching', email: 'james@mindshift.co',
      classification: 'INTERESTED', preview: 'Interesting, but what exactly does this cost?', date: '5 hours ago',
      fullThread: ['James: Interesting, but what exactly does this cost?'] },
    { id: 'r-3', from: 'Emily Watson', company: 'ScaleUp Mentors', email: 'emily@scaleup.io',
      classification: 'OUT_OF_OFFICE', preview: 'Thanks for reaching out. I\'m currently out of the office until April 28th.', date: '1 day ago',
      fullThread: ['Emily: Thanks for reaching out. I\'m currently out of the office until April 28th.'] },
    { id: 'r-4', from: 'Marcus Chen', company: 'LaunchPad Courses', email: 'marcus@launchpad.com',
      classification: 'NOT_INTERESTED', preview: 'Not interested at this time, thanks.', date: '1 day ago',
      fullThread: ['Marcus: Not interested at this time, thanks.'] },
  ],

  '/api/alerts': [
    { label: 'Domain degraded', severity: 'warning', detail: 'outreach-3.hyperscalelabs.com has 2 temporary blacklistings', action: 'View Domain', timestamp: '1h ago' },
    { label: 'Budget alert', severity: 'info', detail: 'NeverBounce at 37% of monthly cap', action: 'View Budgets', timestamp: '3h ago' },
  ],

  '/api/paperclip/actions': {
    recent: [
      { action: 'Rotated keyword weights based on 7-day yield', reasoning: '"business coach" promoted to #1 (34% ICP pass rate), "coaching program launch" deprioritized (10%)', timestamp: '1h ago' },
      { action: 'Scaled Instagram scrape volume +15%', reasoning: 'Midday check: Instagram behind daily target (49/100). Increasing keyword coverage.', timestamp: '4h ago' },
      { action: 'Morning assessment: Pipeline RUNNING', reasoning: 'Yesterday: 478/500 target (95.6%), ICP pass 27%, 4 bookings. All systems healthy.', timestamp: '6h ago' },
    ],
    history: [
      { id: 'pa-1', action: 'Keyword weight adjustment', reasoning: 'Weekly yield analysis', timestamp: today, status: 'Executed' },
      { id: 'pa-2', action: 'Scrape volume increase', reasoning: 'Behind daily target', timestamp: today, status: 'Executed' },
      { id: 'pa-3', action: 'Inbox rotation', reasoning: 'Domain reputation drop', timestamp: today, status: 'Executed' },
    ],
    digest: {
      title: 'Daily Digest — ' + today,
      sections: [
        { heading: 'Pipeline Performance', body: '478 leads generated yesterday (95.6% of target). ICP pass rate: 27%. 4 calls booked.' },
        { heading: 'Top Keywords', body: '"business coach" (34% ICP), "life coach training" (28% ICP), "coaching certification" (31% ICP)' },
        { heading: 'Deliverability', body: '9/10 domains healthy. outreach-3 has temporary blacklisting — monitoring.' },
      ],
    },
  },

  '/api/paperclip/recommendations': [
    { id: 'rec-1', title: 'Add "career transition coach" keyword', reasoning: 'Trending search volume +35% MoM, similar niches show 25%+ ICP pass rate.', priority: 'medium' },
    { id: 'rec-2', title: 'Rotate outreach-3.hyperscalelabs.com', reasoning: '2 temporary blacklistings detected. Recommend swapping to standby domain.', priority: 'high' },
  ],

  '/api/sessions': [
    { service: 'Instagram', accounts: [
      { account: 'scout_ig_01', status: 'active', lastReauth: '2 days ago', failureCount: 0 },
      { account: 'scout_ig_02', status: 'active', lastReauth: '5 days ago', failureCount: 0 },
      { account: 'scout_ig_03', status: 'cooldown', lastReauth: '1 day ago', failureCount: 2 },
      { account: 'scout_ig_04', status: 'active', lastReauth: '3 days ago', failureCount: 0 },
    ]},
  ],

  '/api/manual-review': [],

  '/api/settings': [
    { provider: 'meta', label: 'Meta (Facebook)', configured: true, masked: '●●●●a4f2', status: 'connected', category: 'Social Platforms' },
    { provider: 'instantly', label: 'Instantly', configured: true, masked: '●●●●x9k1', status: 'connected', category: 'Email Infrastructure' },
    { provider: 'anthropic', label: 'Anthropic (Claude)', configured: true, masked: '●●●●m7p3', status: 'connected', category: 'AI & Search' },
    { provider: 'neverbounce', label: 'NeverBounce', configured: true, masked: '●●●●b2j8', status: 'connected', category: 'Email Validation' },
    { provider: 'bounceban', label: 'BounceBan', configured: true, masked: '●●●●c5n4', status: 'connected', category: 'Email Validation' },
    { provider: 'exa', label: 'Exa Search', configured: true, masked: '●●●●d1r6', status: 'connected', category: 'AI & Search' },
    { provider: 'apollo', label: 'Apollo.io', configured: false, masked: '', status: 'not_configured', category: 'Lead Enrichment' },
    { provider: 'snovio', label: 'Snov.io', configured: false, masked: '', status: 'not_configured', category: 'Lead Enrichment' },
    { provider: 'lusha', label: 'Lusha', configured: false, masked: '', status: 'not_configured', category: 'Lead Enrichment' },
    { provider: 'getprospect', label: 'GetProspect', configured: false, masked: '', status: 'not_configured', category: 'Lead Enrichment' },
    { provider: 'hetrixtools', label: 'HetrixTools', configured: false, masked: '', status: 'not_configured', category: 'Deliverability' },
    { provider: 'openai', label: 'OpenAI', configured: false, masked: '', status: 'not_configured', category: 'AI & Search' },
  ],

  '/api/settings/services': [],
  '/api/settings/flags': {},

  '/api/settings/onboarding-status': {
    complete: true,
    steps: {
      apiKeys: { configured: 6, required: 3, requiredProviders: ['meta', 'instantly', 'anthropic'] },
      keywords: { count: 10, minimum: 5 },
      sources: { configured: 2, minimum: 1 },
      schedule: { configured: true },
    },
  },

  '/api/schedule': {
    enabled: true,
    cronExpression: '0 6 * * *',
    dailyTarget: 500,
    sourceWeights: { FACEBOOK_ADS: 60, INSTAGRAM: 40 },
    keywordRotationEnabled: true,
    keywordMaxUses: 10,
    timezone: 'UTC',
  },

  '/api/deliverability/overview': {
    domains: { total: 10, healthy: 8, degraded: 1, blacklisted: 1 },
    inboxes: { total: 30, active: 20, standby: 5, warming: 3, burned: 2 },
    capacity: { totalDaily: 600, utilized: 285, available: 315 },
    compliance: { dkimPass: 9, spfPass: 10, dmarcPass: 8, total: 10 },
    averageDomainAgeDays: 52,
  },

  '/api/deliverability/domains': Array.from({ length: 10 }, (_, i) => ({
    id: `dom-${i + 1}`,
    domain: `outreach-${i + 1}.hyperscalelabs.com`,
    healthStatus: i === 2 ? 'DEGRADED' : i === 7 ? 'BLACKLISTED' : 'HEALTHY',
    dkimOk: i !== 5,
    spfOk: true,
    dmarcOk: i !== 3 && i !== 5,
    blacklistTemp: i === 2 ? 2 : 0,
    blacklistPerm: i === 7 ? 1 : 0,
    reputation: i === 7 ? 'POOR' : i === 2 ? 'FAIR' : 'GOOD',
    inboxCount: 3,
    lastChecked: new Date(Date.now() - i * 3600_000).toLocaleString(),
  })),

  '/api/deliverability/inboxes': Array.from({ length: 12 }, (_, i) => ({
    id: `inbox-${i + 1}`,
    email: `alex${i + 1}@outreach-${Math.floor(i / 3) + 1}.hyperscalelabs.com`,
    status: i < 8 ? 'ACTIVE' : i < 10 ? 'STANDBY' : i === 10 ? 'WARMING' : 'BURNED',
    campaignName: i < 8 ? (i % 2 === 0 ? 'FB Ads — Coaching' : 'IG — Coaching') : null,
    dailyLimit: 30,
    warmupEmailsSent: i < 10 ? 100 : 67,
    provider: 'Google Workspace',
    domainId: `dom-${Math.floor(i / 3) + 1}`,
  })),

  '/api/deliverability/capacity': { totalDaily: 600, utilized: 285, available: 315 },
};

export function getMockResponse(path: string): unknown | undefined {
  if (MOCK_RESPONSES[path]) return MOCK_RESPONSES[path];

  if (path.startsWith('/api/leads/')) {
    const id = path.split('/').pop();
    const lead = MOCK_LEADS.find(l => l.id === id);
    if (lead) return {
      ...lead,
      firstName: lead.contact.split(' ')[0],
      lastName: lead.contact.split(' ').slice(1).join(' '),
      companyName: lead.company,
      landingPageUrl: 'https://example.com/webinar',
      instagramUrl: lead.source === 'Instagram' ? `https://instagram.com/${lead.company.toLowerCase().replace(/\s/g, '')}` : null,
      employeeCount: Math.floor(5 + Math.random() * 35),
      icpScore: lead.score,
      personalization: { leadMagnet: 'your free coaching business masterclass' },
      timeline: [
        { event: 'Scraped', timestamp: lead.date, detail: `From ${lead.source}` },
        { event: 'Deduplicated', timestamp: lead.date, detail: 'Unique lead confirmed' },
        { event: 'Enriched', timestamp: lead.date, detail: 'Email found via landing page' },
        { event: 'Scored', timestamp: lead.date, detail: `ICP score: ${lead.score}` },
      ],
    };
  }

  return undefined;
}
