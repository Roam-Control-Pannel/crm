/**
 * SOCIAL-THEMES-V1
 *
 * Roam Local social-content theme bank. The auto-generate cron (Patch 3c)
 * rotates through these to keep the calendar topped up to a configurable
 * window (default 14 days).
 *
 * Each theme is a directive for the AI: a 60-120 word prompt written in
 * the Roam Local voice. The cron passes account context (which platform,
 * which region/town) so the AI localises generic themes per account.
 *
 * The settings UI (Patch 3b) lets the user enable/disable, edit, reorder,
 * and add themes. UI-edited themes persist to Netlify Blobs and override
 * this seed file. If the override store is empty, the cron uses these
 * defaults verbatim.
 *
 * To add a theme by hand: append to SEED_THEMES below and ship. The cron
 * will pick it up on the next run.
 */

export type ThemeCategory =
  | 'local_discovery'      // hidden spots, "what locals know" — the core thing
  | 'business_spotlight'   // featuring listed businesses, owners, success stories
  | 'traveller_tips'       // practical advice for visitors using the app
  | 'app_features'         // soft mentions of QR codes, friends nearby, plan cards
  | 'brand_personality'    // voice-driven, not selling
  | 'partnership_news'     // Belfast City Council / Visit Belfast / Translink angles
  | 'seasonal_local';      // events, weather, seasonal rhythms

export interface Theme {
  id: string;
  title: string;
  prompt: string;
  category: ThemeCategory;
  enabled: boolean;
  // BRIEF-IDS-V1: which briefs this theme is appropriate for. The cron
  // matches an account's briefId against this list when picking themes
  // for that account's slots. Empty array = no brief matches (theme is
  // effectively disabled until briefIds is populated via the UI).
  briefIds: string[];
}

/**
 * Seed brief IDs — the three briefs that ship with the CRM. The cron
 * uses these as defaults; user-added briefs can also be referenced once
 * the settings UI (Patch 3b) is wired up.
 */
export const BRIEF_IDS = {
  ROAM_LOCAL: 'brief-roam-local',        // UK Tourism
  ROAM_NI: 'brief-roam-ni',              // NI Tourism
  ROAM_BUSINESS: 'brief-roam-business',  // B2B
} as const;

/**
 * Seed themes. 25 total. Edit by hand here OR via the settings UI (Patch 3b).
 *
 * Voice rules apply (see VOICE-RULES-V1 in app/social/page.tsx):
 *   - 80-120 words LinkedIn / 50-80 Facebook / 40-60 Instagram
 *   - No invented stats
 *   - Witty friend, not brand consultant
 *   - Hook → observation → one thing for the reader
 *   - Zero or one emoji
 */
export const SEED_THEMES: Theme[] = [
  // ============================================================
  // local_discovery (8) — the core Roam Local thing
  // ============================================================
  {
    id: 'local_discovery_90_seconds',
    title: 'The 90-second decision',
    category: 'local_discovery',
    enabled: true,
    briefIds: ['brief-roam-local', 'brief-roam-ni'],
    prompt: `Write a post about how people decide where to eat or drink in roughly 90 seconds. Don't invent stats. Lean on what's plainly true: people scan for photos, hours, and a recognisable name. They want to know if it's open, what it looks like, and whether anyone they trust has been. Make the point that a polished tagline matters less than one clear photo of the actual food or room. Tone: the witty friend who happens to know how this stuff works, not a brand consultant. End with one observation the reader will recognise from their own behaviour.`,
  },
  {
    id: 'local_discovery_what_locals_know',
    title: 'What locals know',
    category: 'local_discovery',
    enabled: true,
    briefIds: ['brief-roam-local', 'brief-roam-ni'],
    prompt: `Write about the gap between what locals know and what visitors find. The visitor gets the place at the top of the search results. The local goes two streets over to a place with no website and a queue at the door. The point isn't that visitors are dumb — it's that the signal locals use (word of mouth, who's there at 6pm) doesn't show up in search. Roam Local exists because that signal deserves a way to surface. Don't pitch the app — just make the observation. End with something that lands.`,
  },
  {
    id: 'local_discovery_three_streets',
    title: 'Three streets, three different cities',
    category: 'local_discovery',
    enabled: true,
    briefIds: ['brief-roam-local', 'brief-roam-ni'],
    prompt: `Write about how a single town has multiple personalities depending on where you walk. The high street is one place. Two streets back is another. The riverside or the harbour is a third. Most visitors only see one. Make the point that "exploring" a town isn't about distance — it's about turning. End with a nudge to take the wrong turn next time.`,
  },
  {
    id: 'local_discovery_wrong_turn',
    title: 'The wrong turn',
    category: 'local_discovery',
    enabled: true,
    briefIds: ['brief-roam-local', 'brief-roam-ni'],
    prompt: `Write about how the best places are usually one street off the main one. The main street pays the highest rent and serves the safest food. The street parallel to it is where the people who actually live there go. Don't lecture. Tell it like a small observation you've noticed everywhere you've been. End with a single line that gives the reader permission to wander.`,
  },
  {
    id: 'local_discovery_photos_beat_taglines',
    title: 'Photos beat taglines',
    category: 'local_discovery',
    enabled: true,
    briefIds: ['brief-roam-local', 'brief-roam-ni'],
    prompt: `Write about why a good photo of the actual food matters more than a clever name or strapline. Nobody picks a restaurant on the basis of "Where flavour comes home." They pick it on the basis of "that pasta looked incredible." Make the point gently — this is a useful thing for small business owners to hear, not a roast. End with a practical observation: the photo on the door does more work than the menu inside.`,
  },
  {
    id: 'local_discovery_5pm_shift',
    title: 'The 5pm shift',
    category: 'local_discovery',
    enabled: true,
    briefIds: ['brief-roam-local', 'brief-roam-ni'],
    prompt: `Write about how a town transforms between afternoon and evening. The same street looks different at 3pm and 7pm. Different shops open, different people walking, different smell coming out of the kitchens. Make the point that "the best places" depend on when you're there. End with the observation that visitors who only do daytime miss half the town.`,
  },
  {
    id: 'local_discovery_fifth_pub',
    title: 'The fifth pub',
    category: 'local_discovery',
    enabled: true,
    briefIds: ['brief-roam-local', 'brief-roam-ni'],
    prompt: `Write about how everyone knows the first four pubs in any town — the ones with reviews, the ones on the tourist map, the ones with signage. The fifth pub is the one where the locals are. No website, often no Google entry, definitely no neon. The point: places worth knowing don't always announce themselves. End with a small line about earning the fifth pub.`,
  },
  {
    id: 'local_discovery_map_gaps',
    title: 'Map gaps',
    category: 'local_discovery',
    enabled: true,
    briefIds: ['brief-roam-local', 'brief-roam-ni'],
    prompt: `Write about places that exist but Google doesn't quite see. The pop-up that runs Saturdays only. The bakery whose listing was last updated in 2018. The bar that does the best Guinness on the street and has no website at all. The internet has gaps. Make the observation honestly — this isn't a failure of search, it's just how local works. End with a small nod to the value of word of mouth.`,
  },

  // ============================================================
  // business_spotlight (4) — featuring listed businesses
  // ============================================================
  {
    id: 'business_spotlight_five_year_secret',
    title: 'The five-year-old secret',
    category: 'business_spotlight',
    enabled: true,
    briefIds: ['brief-roam-business'],
    prompt: `Write about a business that's been quietly brilliant for years and never quite figured out marketing. They have great food, loyal regulars, decent reviews — and a website from 2017. The point isn't that they're failing. It's that excellent local businesses often don't have the time, budget, or interest to learn social marketing on top of running the place. Roam Local is for that gap. Don't pitch the app overtly — make the observation about the businesses themselves. End with something warm.`,
  },
  {
    id: 'business_spotlight_why_listed',
    title: 'Why they\'re listed',
    category: 'business_spotlight',
    enabled: true,
    briefIds: ['brief-roam-business'],
    prompt: `Write about what earns a place a spot on Roam Local. Not paid placement. Not the loudest. Places that locals actually rate, that pass the "would I send my mate here" test. Make the point that being listed means something specific. Tone: confident but not boastful — this is how we operate, here's why. End with an invitation to look at the map and see who's there.`,
  },
  {
    id: 'business_spotlight_owner_story',
    title: 'The owner\'s story',
    category: 'business_spotlight',
    enabled: true,
    briefIds: ['brief-roam-business'],
    prompt: `Write about how every good local business has a "before" story. Someone who was a chef somewhere else, or a teacher who started baking on weekends, or a couple who moved back to their hometown. Make the point that the place behind the place — the human story — is half of why locals get attached to it. Don't get sappy. Just observe that this is what makes "local" mean something. End with a small line about the next place you walk into having a story like that.`,
  },
  {
    id: 'business_spotlight_repeat_customer',
    title: 'The repeat customer',
    category: 'business_spotlight',
    enabled: true,
    briefIds: ['brief-roam-business'],
    prompt: `Write about why people keep coming back to one specific spot. It's rarely the food alone. It's the welcome, the dog at the bar, the owner who remembers your order, the booth in the corner that's somehow always free. Make the point that loyalty in local hospitality is built from small specific things. End with the reader thinking of the place they keep going back to.`,
  },

  // ============================================================
  // traveller_tips (3) — practical advice for visitors
  // ============================================================
  {
    id: 'traveller_tips_two_hours_no_plan',
    title: 'Two hours, no plan',
    category: 'traveller_tips',
    enabled: true,
    briefIds: ['brief-roam-local', 'brief-roam-ni'],
    prompt: `Write practical advice for what to do when you've got an unexpected two-hour gap in a town you don't know well. Don't recommend specific places — give the reader a strategy. Walk one street, eat where the locals are, ask one person where they'd go. Tone: useful, not preachy. End with the observation that two unplanned hours often beat a whole afternoon of itinerary.`,
  },
  {
    id: 'traveller_tips_off_main_strip',
    title: 'Off the main strip',
    category: 'traveller_tips',
    enabled: true,
    briefIds: ['brief-roam-local', 'brief-roam-ni'],
    prompt: `Write about why the best meal is rarely on the main street. Main-street places serve volume; back-street places serve regulars. Make the practical point that walking five extra minutes usually gets the visitor a noticeably better dinner. Don't be smug about it. End with a small line about the worth of the detour.`,
  },
  {
    id: 'traveller_tips_walk_between',
    title: 'The walk between',
    category: 'traveller_tips',
    enabled: true,
    briefIds: ['brief-roam-local', 'brief-roam-ni'],
    prompt: `Write about how to pick where to go next when you're already out and the original plan has gone sideways. The trick is the walk between, not the destination — what catches your eye on the way often beats whatever you set out for. Make the practical point: leave time to be diverted. End with a nudge to trust the walk.`,
  },

  // ============================================================
  // app_features (3) — soft mentions of Roam Local features
  // ============================================================
  {
    id: 'app_features_friends_nearby',
    title: 'Friends nearby',
    category: 'app_features',
    enabled: true,
    briefIds: ['brief-roam-business'],
    prompt: `Write a soft post about the experience of bumping into friends when you're out — and how often you nearly miss each other by one street. Roam Local has a friends-nearby feature for exactly this. Don't make the post a feature announcement. Make it about the moment: the text after the fact, "wait, you were where?" End with a light mention that this is one of the things the app quietly does.`,
  },
  {
    id: 'app_features_plan_cards',
    title: 'Plan cards',
    category: 'app_features',
    enabled: true,
    briefIds: ['brief-roam-business'],
    prompt: `Write about the experience of saving a small route through a town — three places you want to hit, in order, with timing. Roam Local does this with plan cards. The post should be about the human side: the satisfaction of having a plan that's actually shaped to the day, not a generic guide. Don't oversell. End with a line about the difference between "wandering with intent" and "wandering blind."`,
  },
  {
    id: 'app_features_qr_shortcut',
    title: 'The QR shortcut',
    category: 'app_features',
    enabled: true,
    briefIds: ['brief-roam-business'],
    prompt: `Write about why scanning a QR code beats typing a place's name into search. You skip the homonyms, the ten near-matches, the verification step. You get the actual place, instantly. Roam Local uses QR codes for this. Make the post about the small frictionless moment, not the technology. End with a small line on how the best tools disappear.`,
  },

  // ============================================================
  // brand_personality (4) — voice-driven, not selling
  // ============================================================
  {
    id: 'brand_personality_anywhere_trap',
    title: 'The "anywhere" trap',
    category: 'brand_personality',
    enabled: true,
    briefIds: ['brief-roam-local', 'brief-roam-ni', 'brief-roam-business'],
    prompt: `Write about the phrase "you can find this anywhere" and why it's usually a lie — or worse, a missed opportunity. The places that say "we're nothing special" are often the places worth finding, because they're not playing the brand game. Make the point with a light touch. End with a small observation: "ordinary" and "rare" overlap more than people think.`,
  },
  {
    id: 'brand_personality_reviews_leave_out',
    title: 'What reviews leave out',
    category: 'brand_personality',
    enabled: true,
    briefIds: ['brief-roam-local', 'brief-roam-ni', 'brief-roam-business'],
    prompt: `Write about the things a Google review never quite captures. The smell of the place when you walk in. The light at 4pm. The fact that the owner's kid is doing homework in the corner. Reviews flatten experience into stars. Make the point that local discovery needs more than ratings. End with a small observation about what makes a place feel real.`,
  },
  {
    id: 'brand_personality_friend_recommendation',
    title: 'The friend recommendation',
    category: 'brand_personality',
    enabled: true,
    briefIds: ['brief-roam-local', 'brief-roam-ni', 'brief-roam-business'],
    prompt: `Write about why one person's tip beats 200 reviews. The friend who knows your taste and tells you exactly which thing to order does in 10 seconds what 200 strangers can't. Make the point that local discovery is closer to friendship than to algorithms. End with a small line about who you ask, and why.`,
  },
  {
    id: 'brand_personality_honest_beats_polished',
    title: 'Honest beats polished',
    category: 'brand_personality',
    enabled: true,
    briefIds: ['brief-roam-local', 'brief-roam-ni', 'brief-roam-business'],
    prompt: `Write about how a phone-camera photo of a real plate of food beats a styled studio shot every time. Polished is suspicious; honest looks like dinner. Make the point gently — this is for small business owners to internalise, not a roast of marketing agencies. End with a single line about what the customer is actually looking at.`,
  },

  // ============================================================
  // partnership_news (1) — generic placeholder
  // ============================================================
  {
    id: 'partnership_news_generic',
    title: 'Roam Local + [partner]',
    category: 'partnership_news',
    enabled: true,
    briefIds: ['brief-roam-local', 'brief-roam-ni', 'brief-roam-business'],
    prompt: `PLACEHOLDER — customise this prompt with specifics when there's actual partnership news (Belfast City Council, Visit Belfast, Translink, Darlington First, Newcastle First, etc.). Generic structure: open with the partner's name and what they do. State what the collaboration enables for locals or visitors. End with one specific thing the reader can do or notice as a result. Keep it warm and concrete — partnerships posts go cold fast when they read like press releases.`,
  },

  // ============================================================
  // seasonal_local (2) — events, weather, seasonal rhythms
  // ============================================================
  {
    id: 'seasonal_local_weather_plan',
    title: 'Today\'s weather, today\'s plan',
    category: 'seasonal_local',
    enabled: true,
    briefIds: ['brief-roam-local', 'brief-roam-ni'],
    prompt: `Write about how the weather actually changes where people go in a town. Sunny afternoon: the harbour, the beer gardens, the parks. Rainy Tuesday: the museum café, the bookshop, the long lunch. Make the point that the best plan adjusts to the day, and most static guidebooks don't. End with a small observation about reading the day before reading the map.`,
  },
  {
    id: 'seasonal_local_event_day',
    title: 'Event-day rhythm',
    category: 'seasonal_local',
    enabled: true,
    briefIds: ['brief-roam-local', 'brief-roam-ni'],
    prompt: `Write about the way a town shifts when something's on — a match, a market, a festival. The streets reorganise themselves. Some places hide; others come alive. Make the practical point that knowing the event calendar is half of knowing a town. End with a small observation about the difference between a normal Tuesday and a Tuesday with something on.`,
  },
];

/**
 * Returns only enabled themes — what the cron should pick from.
 */
export function getEnabledThemes(): Theme[] {
  return SEED_THEMES.filter(t => t.enabled);
}

/**
 * BRIEF-IDS-V1
 * Returns enabled themes that match a given brief. Used by the cron when
 * picking themes for a specific account's slots — the cron looks up the
 * account's briefId, then asks for themes that fit that brief.
 *
 * If the brief has zero matching themes (e.g. user disabled everything
 * relevant), the cron falls back to brand_personality themes since those
 * are flagged for all three seed briefs.
 */
export function getThemesForBrief(briefId: string): Theme[] {
  return SEED_THEMES.filter(t => t.enabled && t.briefIds.includes(briefId));
}

/**
 * Returns themes filtered by category.
 */
export function getThemesByCategory(category: ThemeCategory): Theme[] {
  return SEED_THEMES.filter(t => t.category === category);
}

/**
 * Lookup by ID. Returns undefined if not found.
 */
export function getThemeById(id: string): Theme | undefined {
  return SEED_THEMES.find(t => t.id === id);
}

/**
 * All categories in display order.
 */
export const THEME_CATEGORIES: { id: ThemeCategory; label: string }[] = [
  { id: 'local_discovery',    label: 'Local discovery' },
  { id: 'business_spotlight', label: 'Business spotlight' },
  { id: 'traveller_tips',     label: 'Traveller tips' },
  { id: 'app_features',       label: 'App features' },
  { id: 'brand_personality',  label: 'Brand personality' },
  { id: 'partnership_news',   label: 'Partnership news' },
  { id: 'seasonal_local',     label: 'Seasonal & local' },
];
