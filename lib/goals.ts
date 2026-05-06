export interface GoalOption {
  id: string;
  label: string;
  description: string;
}

export const GOAL_OPTIONS: GoalOption[] = [
  { id: 'awareness', label: 'Awareness', description: 'Introduce, educate, build profile' },
  { id: 'engagement', label: 'Engagement', description: 'Conversation-starting, shareable, replies' },
  { id: 'app_downloads', label: 'Drive app downloads', description: 'Position the Roam app, soft CTA' },
  { id: 'drive_listings', label: 'Drive listings (B2B)', description: 'Persuade businesses to list on Roam' },
  { id: 'recruit_founders', label: 'Recruit founders', description: 'Build affinity with entrepreneurs' },
  { id: 'event_promo', label: 'Event promotion', description: 'Promote a specific event with a CTA' },
];

export function getGoalLabel(id?: string): string | undefined {
  if (!id) return undefined;
  return GOAL_OPTIONS.find(g => g.id === id)?.label;
}
