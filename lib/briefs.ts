// Brief = a strategic content track. Maps purpose to platforms.
// Different from Account (a platform handle) and Channel (a connected OAuth integration).

import { loadWithMigration, saveRemote } from './client-store';

export interface Brief {
  id: string;
  name: string;
  description: string;
  audience: string;
  tone: string;
  contentBrief: string;
  hashtags: string;
  color: string;
  active: boolean;
  createdAt: string;
  /**
   * Long-form brand voice guide for this brief. Free-text — usually a few
   * paragraphs covering vocabulary, phrasing dos/don'ts, taglines, and any
   * other voice rules the AI should follow when writing for this brand.
   * Injected into the Roam-io system prompt so generated content sounds on-brand.
   */
  brandVoice?: string;
}

export const DEFAULT_BRIEFS: Brief[] = [
  {
    id: 'brief-roam-local',
    name: 'Roam Local',
    description: 'UK discovery — towns, places of interest, local businesses worth visiting',
    audience: 'UK locals & visitors discovering towns, places, and independent businesses',
    tone: 'Warm, visual, discovery-led, inspiring',
    contentBrief: 'Town features, hidden gems, food scenes, independent businesses, coastal and countryside spots across the UK',
    hashtags: '#RoamLocal #HiddenGems #IndependentBusiness #LocalLove #DiscoverUK',
    color: '#9b2752',
    active: true,
    createdAt: new Date().toISOString(),
  },
  {
    id: 'brief-roam-ni',
    name: 'Roam NI',
    description: 'Northern Ireland tourism — places of interest, NI towns, businesses',
    audience: 'NI locals, visitors, NI business owners',
    tone: 'Local pride, community warmth, NI personality',
    contentBrief: 'NI towns, local businesses, NI food and culture, community stories, stunning NI landscapes',
    hashtags: '#RoamNI #NorthernIreland #LoveNI #NIBusiness #ExploreNI',
    color: '#c47a1a',
    active: true,
    createdAt: new Date().toISOString(),
  },
  {
    id: 'brief-roam-business',
    name: 'Roam for Business',
    description: 'B2B content — for businesses considering listing on Roam',
    audience: 'Local business owners, entrepreneurs, SME decision makers',
    tone: 'Professional, growth-focused, empowering, data-driven',
    contentBrief: 'Business spotlights, listing benefits, growth stats, founder stories, local economy insights',
    hashtags: '#LocalBusiness #IndependentBusiness #SmallBusiness #UKBusiness #SupportLocal',
    color: '#185FA5',
    active: true,
    createdAt: new Date().toISOString(),
  },
];

/**
 * Fetch the user's briefs from the server. If the server has nothing yet,
 * migrate any legacy localStorage briefs to the server. If neither exists,
 * seed and persist the DEFAULT_BRIEFS.
 *
 * Async because it talks to the server. UI code should call this in useEffect.
 */
export async function fetchBriefs(): Promise<Brief[]> {
  const remote = await loadWithMigration<Brief[]>('briefs');
  // FAIL-CLOSED-READS-V1
  // The seed-and-persist below is only correct for a genuinely empty
  // account. When a failed read also looked like "nothing stored", a single
  // 500 from /api/store/briefs was enough to overwrite every real brief with
  // the three defaults — permanently, since the write went straight to the
  // server. Throwing keeps the user's data and lets the page say so.
  if (!remote.ok) {
    throw new BriefsUnavailableError(remote.error);
  }
  const data = remote.data;
  if (data && Array.isArray(data) && data.length > 0) {
    return data;
  }
  // First run on this account — seed with defaults and persist them.
  await saveRemote('briefs', DEFAULT_BRIEFS);
  return DEFAULT_BRIEFS;
}

/**
 * Thrown when the briefs could not be read. Distinct from "there are no
 * briefs" so callers never confuse the two — see FAIL-CLOSED-READS-V1.
 */
export class BriefsUnavailableError extends Error {
  constructor(detail: string) {
    super(detail || 'Could not load briefs');
    this.name = 'BriefsUnavailableError';
  }
}

/**
 * Persist briefs to the server. UI code should call this whenever briefs change.
 */
export async function persistBriefs(briefs: Brief[]): Promise<void> {
  await saveRemote('briefs', briefs);
}
