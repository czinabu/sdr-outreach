// Industry playbooks distilled from how experienced SDRs prospect each market.
// Each one is kept to a few short lines so it fits small local models alongside the rest of the prompt.

export type CadenceStep = { day: number; channel: "LinkedIn" | "Email" | "Phone"; action: string };

export type Playbook = {
  label: string;
  /** What buyers in this industry care about and respond to. */
  angles: string;
  /** Wording that lands with these buyers, and wording to avoid. */
  language: string;
  /** Which channels work best and how to use them. */
  channels: string;
  cadence: CadenceStep[];
};

// A three-week, three-channel sequence: the shape most outbound teams converge on.
const STANDARD_CADENCE: CadenceStep[] = [
  { day: 1, channel: "LinkedIn", action: "Send the connection request" },
  { day: 1, channel: "Email", action: "Send the first email" },
  { day: 3, channel: "Phone", action: "Call; if no answer, leave the voicemail" },
  { day: 5, channel: "Email", action: "Reply in the same thread with one new idea or proof point" },
  { day: 8, channel: "Phone", action: "Call again at a different time of day" },
  { day: 10, channel: "LinkedIn", action: "If connected, send the follow-up message" },
  { day: 14, channel: "Email", action: "Share a short customer example or useful resource" },
  { day: 21, channel: "Email", action: "Send a polite break-up email and ask if you should check back next quarter" },
];

export const PLAYBOOKS: Record<string, Playbook> = {
  general: {
    label: "General / not sure",
    angles: "Tie the offer to one concrete outcome for their role: saving time, cutting cost, or growing revenue.",
    language: "Plain, specific, human. Avoid buzzwords like 'synergy', 'revolutionize' and 'cutting-edge'.",
    channels: "Mix LinkedIn, email and phone; most replies come after the third to fifth touch.",
    cadence: STANDARD_CADENCE,
  },
  saas: {
    label: "Software & tech",
    angles: "Buyers get pitched constantly. Lead with a trigger (funding, hiring, a new launch, tool changes) and a measurable result like hours saved or pipeline added.",
    language: "Short and direct. Technical buyers want specifics and hate hype words like 'AI-powered' and 'game-changing'.",
    channels: "Email and LinkedIn carry most of the load; calls work best for managers and directors, less for engineers.",
    cadence: STANDARD_CADENCE,
  },
  healthcare: {
    label: "Healthcare",
    angles: "Lead with an operational outcome: fewer no-shows, less admin time, faster billing, better patient experience. Mention similar practices or hospitals you work with.",
    language: "Calm and credible, like an operator. Never imply anything about specific patients. Avoid 'transform' and 'disrupt'. Mention privacy or HIPAA only if relevant to the offer.",
    channels: "Busy clinicians rarely answer calls; office managers and administrators do. Use email first, then phone during admin hours.",
    cadence: [
      { day: 1, channel: "Email", action: "Send the first email" },
      { day: 2, channel: "LinkedIn", action: "Send the connection request" },
      { day: 4, channel: "Phone", action: "Call the office during admin hours; leave the voicemail" },
      { day: 8, channel: "Email", action: "Reply in the same thread with a result from a similar practice" },
      { day: 12, channel: "Phone", action: "Call again and ask the front desk who handles this" },
      { day: 16, channel: "LinkedIn", action: "If connected, send the follow-up message" },
      { day: 25, channel: "Email", action: "Send a short break-up email and offer to check back later" },
    ],
  },
  manufacturing: {
    label: "Manufacturing & industrial",
    angles: "Speak to uptime, throughput, scrap and rework, safety, and total cost. Triggers: new equipment, plant expansion, hiring for maintenance or quality roles.",
    language: "Practical and no-nonsense. Plant and operations leaders distrust marketing language like 'digital transformation'.",
    channels: "Phone works well; many plant managers are on the floor, so call early (7-9am) and keep emails short enough to read on a phone.",
    cadence: [
      { day: 1, channel: "Phone", action: "Call early in the morning; leave the voicemail" },
      { day: 1, channel: "Email", action: "Send the first email right after the voicemail" },
      { day: 3, channel: "LinkedIn", action: "Send the connection request" },
      { day: 5, channel: "Phone", action: "Call again early" },
      { day: 8, channel: "Email", action: "Reply in the same thread with a plant-floor example" },
      { day: 12, channel: "Phone", action: "Call and ask who owns the problem if it isn't them" },
      { day: 15, channel: "LinkedIn", action: "If connected, send the follow-up message" },
      { day: 21, channel: "Email", action: "Send the break-up email" },
    ],
  },
  finance: {
    label: "Financial services & insurance",
    angles: "Risk, compliance, client retention and efficiency. Credibility matters most: name similar firms and be precise about results.",
    language: "Professional and precise. No exaggerated claims or guarantees; regulated buyers are wary of anything that sounds like a promise.",
    channels: "Email and LinkedIn first; advisors and agents often answer their own phones, so calls work for smaller firms.",
    cadence: STANDARD_CADENCE,
  },
  realestate: {
    label: "Real estate & property",
    angles: "More deals or listings, faster closings, fewer vacancies, less time on admin. Triggers: new listings, new office, recent sales.",
    language: "Friendly and quick. Agents and brokers are on the move; get to the point in the first line.",
    channels: "Phone and text-style short emails work best; many agents live on their phones. LinkedIn matters more for commercial real estate.",
    cadence: STANDARD_CADENCE,
  },
  professional: {
    label: "Legal, accounting & consulting",
    angles: "Billable hours, client experience, and winning more work. Partners care about time; office managers care about smooth operations.",
    language: "Respectful and concise. Avoid casual slang. Show you understand how their firm makes money.",
    channels: "Email first; gatekeepers screen calls, so ask the front desk for the right person. Avoid busy seasons (tax season for accountants).",
    cadence: STANDARD_CADENCE,
  },
  retail: {
    label: "Retail & e-commerce",
    angles: "Sales, conversion rate, average order value, customer retention, and inventory. Triggers: new store, new product line, seasonal peaks.",
    language: "Energetic but concrete. Reference their store, products or site to show you looked.",
    channels: "Email and LinkedIn for e-commerce teams; phone and walk-ins for local store owners. Avoid their peak seasons.",
    cadence: STANDARD_CADENCE,
  },
  education: {
    label: "Education",
    angles: "Student outcomes, teacher time, enrollment, and budget fit. Buying follows the school calendar and budget cycles.",
    language: "Warm and mission-focused. Respect that budgets are tight and decisions involve several people.",
    channels: "Email works best; teachers can't take calls during class. Reach out before budget planning in spring, not during exams.",
    cadence: STANDARD_CADENCE,
  },
  construction: {
    label: "Construction & trades",
    angles: "Winning bids, keeping jobs on schedule, labor shortages, and cash flow. Triggers: new projects, permits, hiring.",
    language: "Straight talk, no corporate jargon. Short sentences.",
    channels: "Phone is king; owners and superintendents are on job sites. Call early morning or late afternoon, and keep emails very short.",
    cadence: [
      { day: 1, channel: "Phone", action: "Call early morning; leave the voicemail" },
      { day: 1, channel: "Email", action: "Send a short first email" },
      { day: 4, channel: "Phone", action: "Call late afternoon" },
      { day: 7, channel: "Email", action: "Reply in the same thread with a job-site example" },
      { day: 10, channel: "LinkedIn", action: "Send the connection request" },
      { day: 14, channel: "Phone", action: "Call again" },
      { day: 21, channel: "Email", action: "Send the break-up email" },
    ],
  },
  local: {
    label: "Small local business",
    angles: "More customers, less time on admin, and simple tools. The owner is usually the buyer and wears every hat.",
    language: "Casual, neighborly and brief. Use their business name and something local.",
    channels: "Phone works best, outside their rush hours (avoid lunch for restaurants). Email is secondary; LinkedIn is often unused.",
    cadence: [
      { day: 1, channel: "Phone", action: "Call outside their busy hours; leave the voicemail" },
      { day: 1, channel: "Email", action: "Send the first email" },
      { day: 4, channel: "Phone", action: "Call again at a different time" },
      { day: 7, channel: "Email", action: "Reply in the same thread with a local example" },
      { day: 10, channel: "LinkedIn", action: "Send the connection request if they're on LinkedIn" },
      { day: 14, channel: "Phone", action: "Call one last time" },
      { day: 21, channel: "Email", action: "Send the break-up email" },
    ],
  },
};

export function playbookFor(industry: string): Playbook | undefined {
  return PLAYBOOKS[industry];
}

/** The playbook as a few prompt lines; free-text industries (not a known key) get none. */
export function playbookPrompt(industry: string): string {
  const playbook = playbookFor(industry);
  if (!playbook) return "";
  return [
    `Industry playbook (${playbook.label}):`,
    `- What lands: ${playbook.angles}`,
    `- Language: ${playbook.language}`,
    `- Channels: ${playbook.channels}`,
  ].join("\n");
}
