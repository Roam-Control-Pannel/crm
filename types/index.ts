export interface Business {
  id?: string;
  name: string;
  type: string;
  town: string;
  region?: string;
  email: string;
  website?: string;
  phone?: string;
  source: 'manual' | 'google' | 'yell';
  status: 'not_contacted' | 'email_sent' | 'followed_up' | 'responded' | 'listed' | 'cold';
  notes?: string;
  brevoContactId?: number;
  createdAt?: string;
  lastContactedAt?: string;
}

export interface Town {
  slug: string;
  name: string;
  region: string;
  population?: string;
  knownFor?: string;
  history?: string;
  localTip?: string;
  areas: string[];
  stage: 'not_started' | 'outreach' | 'businesses_live' | 'flywheel';
  businessCount: number;
  targetCount: number;
}

export interface EmailSequence {
  id: string;
  businessId: string;
  businessName: string;
  town: string;
  email: string;
  currentStep: number;
  totalSteps: number;
  status: 'active' | 'completed' | 'paused' | 'cold';
  nextSendAt?: string;
  openedAt?: string;
  respondedAt?: string;
}

export interface QueueItem {
  id: string;
  type: 'social_post' | 'email' | 'follow_up';
  platform?: 'instagram' | 'linkedin' | 'twitter' | 'facebook';
  town: string;
  title: string;
  description: string;
  content: string;
  scheduledFor?: string;
  status: 'pending' | 'approved' | 'sent' | 'skipped';
  createdAt: string;
}

export interface DashboardStats {
  townsActive: number;
  businessesListed: number;
  postsScheduled: number;
  emailsQueued: number;
  openRate: number;
  listRate: number;
}
