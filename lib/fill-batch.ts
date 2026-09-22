/**
 * FILL-BATCH-V1
 *
 * Submit a whole calendar fill as one Anthropic Message Batch.
 *
 * The synchronous fill (runAutoGenerate) is bounded by the hosting
 * platform's ~26s ceiling: it places roughly one batch of four slots per
 * invocation, so a 14-day fill is ~21 browser round-trips with the tab held
 * open, and it stops wherever the user closes it. This path plans the same
 * slots, picks the same photos, builds the same prompts — literally the same
 * functions — and then hands the whole lot to the Batches API in one
 * request, at half the token cost.
 *
 * What it costs: the captions arrive later, typically within the hour, with
 * no faster guarantee and a 24-hour ceiling. That is a good trade for a
 * calendar being filled a fortnight ahead and a bad one for "give me a post
 * now", so the synchronous path stays and this is the second option rather
 * than a replacement.
 *
 * One honest limitation. In the synchronous fill, each batch of four sees
 * the captions the previous batch wrote (CAPTION-VARIETY-V1 feeds them back
 * as it goes). Here every request is in flight at once, so each one sees the
 * calendar as it stood at submit time and none of its siblings. Filling a
 * sparse fortnight, that means the anti-repetition history is thinner than
 * the synchronous path's — the published back-catalogue still reaches every
 * prompt, but this run's own output does not. Themes and photos are
 * unaffected: both are assigned here, in order, before anything is sent.
 */

import {
  planFill,
  makeRankCache,
  pickBrainImage,
  pickUnsplashImage,
  buildCaptionRequest,
  type RunInput,
  type SlotSpec,
} from '@/lib/social-cron';
import { buildCaptionHistory } from '@/lib/caption-history';
import { createBatch, type BatchRequest } from '@/lib/anthropic-batch';
import { readJobs, writeJobs, type FillJob, type FillJobSlot } from '@/lib/fill-job';

/**
 * Ceiling on one job. Anthropic allows 100,000 requests; this is about what
 * the submit route can plan and prompt-build inside the platform's
 * synchronous limit, and about as far ahead as a calendar is worth filling
 * in one go. A larger plan submits this many and leaves the rest for the
 * next run, which the slot dedup makes safe.
 */
export const MAX_SLOTS_PER_JOB = 120;

/**
 * Wall-clock budget for planning and prompt-building, checked before the
 * batch is submitted. Same ceiling the synchronous fill respects, minus room
 * for the submit POST itself.
 */
const SUBMIT_BUDGET_MS = 18_000;

export interface SubmitResult {
  ok: boolean;
  job?: FillJob;
  /** Set when there was simply nothing to do. */
  nothingToDo?: boolean;
  plannedSlots?: number;
  error?: string;
}

/** custom_id for slot n. Unique within the batch, which is all that is required. */
export function slotCustomId(index: number): string {
  return `slot-${index}`;
}

export async function submitFillBatch(
  input: RunInput,
  apiKey: string
): Promise<SubmitResult> {
  const startedAt = Date.now();
  const now = new Date();

  const plan = await planFill(input, now);
  if (plan.specs.length === 0) {
    return { ok: true, nothingToDo: true, plannedSlots: 0 };
  }
  const specs = plan.specs.slice(0, MAX_SLOTS_PER_JOB);

  // Warm every shortlist first, concurrently. The picks below are local and
  // instant, but each ranking is a network call; doing them inside the
  // sequential pick loop would serialise ~25 requests and blow the budget.
  const ranker = makeRankCache(
    input, plan.brainItems, plan.settings, plan.shortlists, plan.brainFingerprint
  );
  const pairs = new Map<string, SlotSpec>();
  for (const spec of specs) pairs.set(spec.theme.id + '|' + spec.slotBriefId, spec);
  const ranks = new Map<string, Awaited<ReturnType<typeof ranker.get>>>();
  await Promise.all(
    [...pairs.entries()].map(async ([key, spec]) => {
      ranks.set(key, await ranker.get(spec.theme, spec.slotBrief));
    })
  );
  // Persist them: a batch fill of a long window may be run more than once,
  // and the synchronous fill reads the same cache.
  await ranker.flush();

  // Assign photos in slot order, sequentially, so `used` genuinely prevents
  // a repeat. This is the whole reason the ranking pass above is separate:
  // concurrency here would reintroduce the race Phase A closed.
  const used = new Set<string>();
  const slots: FillJobSlot[] = [];
  const requests: BatchRequest[] = [];
  const needsUnsplash: Array<{ index: number; query: string }> = [];

  specs.forEach((spec, index) => {
    const slotTime = new Date(spec.iso).getTime();
    const rank = ranks.get(spec.theme.id + '|' + spec.slotBriefId) || null;
    const brain = pickBrainImage(plan.brainItems, spec.theme, used, spec.slotBrief, {
      usage: plan.imageUsage,
      slotTime,
      cooldownDays: plan.cooldownDays,
      semanticRank: rank,
    });
    const slot: FillJobSlot = {
      customId: slotCustomId(index),
      accountId: spec.account.id,
      briefId: spec.slotBriefId,
      themeId: spec.theme.id,
      scheduledAt: spec.iso,
    };
    if (brain) {
      used.add(brain.url);
      slot.imageUrl = brain.url;
      // IMAGE-CREDIT-V1: a Brain photo is our own asset, so no attribution.
    } else {
      needsUnsplash.push({ index, query: spec.theme.title.split(' ').slice(0, 4).join(' ') });
    }
    slots.push(slot);
  });

  // Unsplash only for the slots the Brain could not serve. Concurrent,
  // because each is a network call and they are independent — but the URLs
  // they return are still reserved one at a time below, so two slots cannot
  // end up with the same stock photo.
  if (needsUnsplash.length > 0 && Date.now() - startedAt < SUBMIT_BUDGET_MS) {
    const picked = await Promise.all(
      needsUnsplash.map(async ({ index, query }) => ({
        index,
        image: await pickUnsplashImage(input.origin, query, input.internalSecret, used, {
          usage: plan.imageUsage,
          slotTime: new Date(specs[index].iso).getTime(),
          cooldownDays: plan.cooldownDays,
        }),
      }))
    );
    for (const { index, image } of picked) {
      if (!image || used.has(image.url)) continue;
      used.add(image.url);
      Object.assign(slots[index], {
        imageUrl: image.url,
        imageCredit: image.credit,
        imageCreditUrl: image.creditUrl,
        imagePhotoUrl: image.photoUrl,
        imageUnsplashUrl: image.unsplashUrl,
        imageSocialHandles: image.socialHandles,
      });
    }
  }

  // Prompts. Identical to the synchronous path because it is the same
  // builder — see CaptionRequest in lib/social-cron.ts.
  specs.forEach((spec, index) => {
    const slot = slots[index];
    const brainItem = slot.imageUrl
      ? plan.brainItems.find(b => b.url === slot.imageUrl)
      : undefined;
    const imageForCaption = brainItem
      ? { description: brainItem.description, tags: brainItem.tags, location: brainItem.folder }
      : undefined;
    const history = buildCaptionHistory(
      plan.captionSource, spec.account.id, new Date(spec.iso).getTime()
    );
    const req = buildCaptionRequest(
      spec.slotBrief, spec.theme, spec.metaForCaption, spec.account,
      spec.iso, imageForCaption,
      { history, model: plan.captionModel.id }
    );
    requests.push({
      custom_id: slot.customId,
      params: {
        model: req.model,
        max_tokens: req.maxTokens,
        system: req.system,
        messages: req.messages,
      },
    });
  });

  const batch = await createBatch(apiKey, requests);

  const job: FillJob = {
    id: 'fill_' + now.getTime().toString(36) + Math.random().toString(36).slice(2, 7),
    batchId: batch.id,
    status: 'submitted',
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    expiresAt: batch.expires_at || undefined,
    slots,
    counts: { requested: slots.length, created: 0, failed: 0, skipped: 0 },
  };

  const jobs = await readJobs();
  await writeJobs([job, ...jobs]);

  return { ok: true, job, plannedSlots: plan.specs.length };
}
