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
  if (remote && Array.isArray(remote) && remote.length > 0) {
    return remote;
  }
  // First run on this account — seed with defaults and persist them.
  await saveRemote('briefs', DEFAULT_BRIEFS);
  return DEFAULT_BRIEFS;
}

/**
 * Persist briefs to the server. UI code should call this whenever briefs change.
 */
export async function persistBriefs(briefs: Brief[]): Promise<void> {
  await saveRemote('briefs', briefs);
}
