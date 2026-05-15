/**
 * Roam-io tool definitions.
 *
 * Single source of truth for what Roam-io can do. Each toolset bundles:
 *   - The Anthropic tool schemas (sent to Claude)
 *   - The executors (run server-side when Claude returns tool_use)
 *   - A requiresConfirm registry (controls whether the client shows a
 *     "Confirm" card before executing the tool)
 *
 * Read tools (list_*) are silent. Writes default to silent for create
 * and toggle, confirm for update/delete. Adjust REQUIRES_CONFIRM below.
 */

import { getCollection, saveCollection, DEFAULT_USER_ID } from './store';

// =================================================================
// Types — kept local on purpose. Task shape mirrors app/tasks/page.tsx.
// If you move Task to types/index.ts later, import from there instead.
// =================================================================
export interface RoamTask {
  id: string;
  title: string;
  description?: string;
  priority: 'high' | 'medium' | 'low';
  category: 'outreach' | 'social' | 'town_activation' | 'admin' | 'ai_suggested';
  assignee: string;
  dueDate: string;        // ISO yyyy-mm-dd
  completed: boolean;
  createdAt: string;
  aiSuggested?: boolean;
}

// =================================================================
// Anthropic tool schemas. These are what we send in `tools: [...]`.
// =================================================================
const TASK_TOOLS = [
  {
    name: 'create_task',
    description:
      'Create a new task on the user\'s task list. Use when the user asks to add, create, schedule, or remind them about something. ' +
      'Always extract concrete dates from the user message (today, tomorrow, Friday, next week). ' +
      'If priority or category are unclear, infer sensible defaults: outreach for contact follow-ups, social for content, ' +
      'town_activation for partnership work, admin for everything else.',
    input_schema: {
      type: 'object' as const,
      properties: {
        title: { type: 'string', description: 'Short task title, max ~80 chars' },
        description: { type: 'string', description: 'Optional longer detail' },
        priority: { type: 'string', enum: ['high', 'medium', 'low'] },
        category: {
          type: 'string',
          enum: ['outreach', 'social', 'town_activation', 'admin'],
        },
        assignee: {
          type: 'string',
          description: 'Who the task is for. Default "Andy".',
        },
        dueDate: {
          type: 'string',
          description: 'ISO date yyyy-mm-dd. Today is the current date.',
        },
      },
      required: ['title', 'priority', 'category', 'dueDate'],
    },
  },
  {
    name: 'list_tasks',
    description:
      'List the user\'s current tasks. Use when the user asks what\'s on their list, what\'s due, what\'s overdue, ' +
      'or wants a recap. Returns open tasks by default; pass includeCompleted to show finished ones.',
    input_schema: {
      type: 'object' as const,
      properties: {
        filter: {
          type: 'string',
          enum: ['all', 'overdue', 'due_today', 'upcoming'],
          description: 'Default "all" (open tasks). Use "overdue" / "due_today" for date-based filtering.',
        },
        assignee: { type: 'string', description: 'Filter to one person, e.g. "Andy"' },
        includeCompleted: { type: 'boolean' },
      },
    },
  },
  {
    name: 'complete_task',
    description:
      'Mark a task as done. Pass the task id returned by list_tasks. Use when the user says they\'ve finished, ' +
      'completed, or done something.',
    input_schema: {
      type: 'object' as const,
      properties: {
        id: { type: 'string', description: 'Task id from list_tasks' },
      },
      required: ['id'],
    },
  },
  {
    name: 'update_task',
    description:
      'Edit an existing task — change its title, due date, priority, etc. Pass the id and only the fields to change.',
    input_schema: {
      type: 'object' as const,
      properties: {
        id: { type: 'string' },
        title: { type: 'string' },
        description: { type: 'string' },
        priority: { type: 'string', enum: ['high', 'medium', 'low'] },
        category: {
          type: 'string',
          enum: ['outreach', 'social', 'town_activation', 'admin'],
        },
        assignee: { type: 'string' },
        dueDate: { type: 'string', description: 'ISO yyyy-mm-dd' },
      },
      required: ['id'],
    },
  },
  {
    name: 'delete_task',
    description:
      'Permanently delete a task. Use only when the user explicitly asks to delete or remove a task, ' +
      'not when they say "done" (use complete_task for that).',
    input_schema: {
      type: 'object' as const,
      properties: {
        id: { type: 'string' },
      },
      required: ['id'],
    },
  },
];

const BRAIN_TOOLS = [
  {
    name: 'save_to_brain',
    description:
      'Save a piece of text to the user\'s Brain knowledge base. Use proactively when the user shares ' +
      'something durable and worth remembering: partnership names, contact details, decisions, key ' +
      'numbers, agreed strategies, or anything the user says "remember this" / "save this" / "keep ' +
      'this in mind" about. Do NOT save trivial conversational filler or things that are obvious from ' +
      'context. Always include 2-5 short tags so the item is searchable later.',
    input_schema: {
      type: 'object' as const,
      properties: {
        content: { type: 'string', description: 'The text to save. Usually 1-3 sentences. Quote the user\'s own words when possible.' },
        description: { type: 'string', description: 'One-line summary, max 140 chars. Shown as the Brain card title.' },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: '2-5 short lowercase kebab-case tags (e.g. "dun-laoghaire", "partnership", "contact-info")',
        },
      },
      required: ['content', 'description', 'tags'],
    },
  },
];

// =================================================================
// Confirmation registry — flip flags here to change UX without touching
// any other file. requiresConfirm: true => client renders the warning card
// and waits for user click before the tool actually executes.
// =================================================================
export const REQUIRES_CONFIRM: Record<string, boolean> = {
  // Tasks
  list_tasks: false,     // read, always silent
  create_task: false,    // cheap + recoverable, no friction
  complete_task: false,  // toggleable
  update_task: true,     // edits feel destructive — confirm
  delete_task: true,     // definitely confirm
  // Brain
  save_to_brain: true,   // user should see what's being saved before it lands
  // Social — reads silent, edits silent, destructive/expensive confirm.
  list_briefs: false,
  list_themes: false,
  list_accounts: false,
  list_social_posts: false,
  get_post: false,
  analyse_calendar: false,
  create_post_draft: false,
  regenerate_caption: false,
  reschedule_post: true,
  delete_post: true,
  bulk_fill_calendar: true,  // expensive — many Claude calls
  plan_content_week: false,  // read-only proposal, no writes
};

// =================================================================
// Toolset registry — chat route picks which schemas to send based on
// the `tools` array in the request body. Add new toolsets here.
// =================================================================
const SOCIAL_TOOLS = [
  // -------- READ tools ---------------------------------------------------
  {
    name: 'list_briefs',
    description:
      'List the user\'s active content briefs (Roam Local, Roam NI, Roam for Business). ' +
      'Returns id, name, and one-line description of each. Use when the user asks "what briefs do I have?" ' +
      'or when you need a brief id for other tools.',
    input_schema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'list_themes',
    description:
      'List social-content themes for a given brief. Each theme is a directive the AI uses to generate posts. ' +
      'Returns id, title, category, and enabled status.',
    input_schema: {
      type: 'object' as const,
      properties: {
        briefId: { type: 'string', description: 'Brief id from list_briefs' },
        onlyEnabled: { type: 'boolean', description: 'Default true' },
      },
      required: ['briefId'],
    },
  },
  {
    name: 'list_accounts',
    description:
      'List connected social media accounts. Returns each account id, platform (linkedin/facebook/instagram), ' +
      'type (personal/company/page), and the briefId mapped to it (if any). Use to resolve account ids for other tools.',
    input_schema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'list_social_posts',
    description:
      'List social posts on the calendar. Filter by status (draft/scheduled/published/failed), date range, brief, ' +
      'or account. Returns id, status, scheduledAt, caption preview (first 100 chars), account ids, brief id. ' +
      'Use when the user asks what\'s scheduled, what\'s in drafts, what\'s already gone out.',
    input_schema: {
      type: 'object' as const,
      properties: {
        status: { type: 'string', enum: ['draft', 'scheduled', 'published', 'failed', 'all'] },
        briefId: { type: 'string' },
        accountId: { type: 'string' },
        from: { type: 'string', description: 'ISO date — include posts scheduledAt >= this' },
        to: { type: 'string', description: 'ISO date — include posts scheduledAt <= this' },
        limit: { type: 'number', description: 'Cap returned items (default 30)' },
      },
    },
  },
  {
    name: 'get_post',
    description:
      'Fetch the full details of one social post by id, including full caption text, image URL, ' +
      'and publish results. Use after list_social_posts when you need the complete caption.',
    input_schema: {
      type: 'object' as const,
      properties: { id: { type: 'string' } },
      required: ['id'],
    },
  },
  {
    name: 'analyse_calendar',
    description:
      'Calendar gap analysis. Looks at the next N days (default 14) and reports which briefs and accounts ' +
      'are underweighted, which dates have no posts scheduled, and overall draft/scheduled/published counts. ' +
      'Use when the user asks "how\'s my calendar looking?" or "what\'s missing this week?".',
    input_schema: {
      type: 'object' as const,
      properties: {
        days: { type: 'number', description: 'Lookahead window in days (default 14)' },
      },
    },
  },
  // -------- WRITE tools (silent) -----------------------------------------
  {
    name: 'create_post_draft',
    description:
      'Create a single social post draft. Generates the caption using the existing pipeline (same voice, ' +
      'same prompt rules as the auto-generate cron). If theme not specified, picks a random enabled theme ' +
      'matching the brief. If scheduledAt not specified, defaults to tomorrow 9am. ' +
      '\n\nIMAGE PICKING: by default no image is attached. If the user explicitly asks for one, pass withImage. ' +
      'If they don\'t mention images, leave withImage as "none" and ask them in your reply (e.g. ' +
      '"Want me to find an image? Brain (your photos) or Unsplash?").',
    input_schema: {
      type: 'object' as const,
      properties: {
        briefId: { type: 'string' },
        accountId: { type: 'string' },
        themeId: { type: 'string', description: 'Optional — random enabled theme picked if absent' },
        scheduledAt: { type: 'string', description: 'ISO datetime — defaults to tomorrow 9am' },
        withImage: { type: 'string', enum: ['none', 'brain', 'unsplash'], description: 'Default "none"' },
        captionOverride: { type: 'string', description: 'If provided, skip AI generation and use this verbatim' },
      },
      required: ['briefId', 'accountId'],
    },
  },
  {
    name: 'regenerate_caption',
    description:
      'Re-run caption generation on an existing draft post. The post\'s brief, theme (random pick), ' +
      'and account context are reused. Useful when the user says "rewrite that Tuesday post" or ' +
      '"make the Newcastle First one punchier".',
    input_schema: {
      type: 'object' as const,
      properties: {
        id: { type: 'string', description: 'Post id from list_social_posts' },
      },
      required: ['id'],
    },
  },
  // -------- WRITE tools (confirm) ----------------------------------------
  {
    name: 'reschedule_post',
    description:
      'Move a post to a different time. User MUST confirm before this fires.',
    input_schema: {
      type: 'object' as const,
      properties: {
        id: { type: 'string' },
        scheduledAt: { type: 'string', description: 'New ISO datetime' },
      },
      required: ['id', 'scheduledAt'],
    },
  },
  {
    name: 'delete_post',
    description: 'Permanently delete a social post (draft or scheduled). User MUST confirm.',
    input_schema: {
      type: 'object' as const,
      properties: { id: { type: 'string' } },
      required: ['id'],
    },
  },
  {
    name: 'bulk_fill_calendar',
    description:
      'Run the auto-generate flow to fill empty slots in the calendar with new drafts. Generates up to ' +
      'one post per account per posting-time slot over the next N days. ' +
      'EXPENSIVE — each post is a Claude API call. User MUST confirm. Use when the user asks ' +
      '"fill my calendar" or "generate next week\'s posts" without specifying individual posts.',
    input_schema: {
      type: 'object' as const,
      properties: {
        lookaheadDays: { type: 'number', description: 'How many days forward to fill (default 7, max 28)' },
      },
    },
  },
  // -------- STRATEGIC ----------------------------------------------------
  {
    name: 'plan_content_week',
    description:
      'Propose a content schedule for a week WITHOUT creating any posts. Returns a structured plan ' +
      '(list of {day, account, brief, theme suggestion, caption angle}). Use when the user wants to ' +
      'think out loud about a week ahead. Follow up the tool result with a natural-language summary and ' +
      'ask if they want you to actually create the drafts (which would call create_post_draft per item).',
    input_schema: {
      type: 'object' as const,
      properties: {
        topic: { type: 'string', description: 'Optional theme of the week, e.g. "Whitstable activation"' },
        days: { type: 'number', description: 'Number of days to plan (default 7)' },
        focusBriefId: { type: 'string', description: 'Optional — if set, weight this brief heavier' },
      },
    },
  },
];

const TOOLSETS: Record<string, any[]> = {
  tasks: TASK_TOOLS,
  brain: BRAIN_TOOLS,
  social: SOCIAL_TOOLS,
};

export function getToolSchemas(toolsets: string[]): any[] {
  const schemas: any[] = [];
  for (const name of toolsets) {
    const set = TOOLSETS[name];
    if (set) schemas.push(...set);
  }
  return schemas;
}

// =================================================================
// Tool executors — server-side. Each returns the JSON payload that goes
// back to Claude as a tool_result content block.
// =================================================================
async function loadTasks(): Promise<RoamTask[]> {
  const data = await getCollection<RoamTask[]>(DEFAULT_USER_ID, 'tasks');
  return Array.isArray(data) ? data : [];
}

async function saveTasks(tasks: RoamTask[]): Promise<void> {
  await saveCollection(DEFAULT_USER_ID, 'tasks', tasks);
}

function todayISO(): string {
  return new Date().toISOString().split('T')[0];
}

function isOverdue(dueDate: string): boolean {
  return new Date(dueDate) < new Date(new Date().setHours(0, 0, 0, 0));
}

function isDueToday(dueDate: string): boolean {
  const d = new Date(dueDate);
  const now = new Date();
  return (
    d.getDate() === now.getDate() &&
    d.getMonth() === now.getMonth() &&
    d.getFullYear() === now.getFullYear()
  );
}

export async function executeTool(name: string, input: any): Promise<any> {
  switch (name) {
    case 'create_task': {
      const tasks = await loadTasks();
      const task: RoamTask = {
        id: Date.now().toString(),
        title: input.title,
        description: input.description || '',
        priority: input.priority || 'medium',
        category: input.category || 'admin',
        assignee: input.assignee || 'Andy',
        dueDate: input.dueDate || todayISO(),
        completed: false,
        createdAt: new Date().toISOString(),
        aiSuggested: true,
      };
      await saveTasks([task, ...tasks]);
      return { ok: true, task };
    }

    case 'list_tasks': {
      const all = await loadTasks();
      let filtered = all;
      if (!input.includeCompleted) filtered = filtered.filter(t => !t.completed);
      if (input.assignee) filtered = filtered.filter(t => t.assignee === input.assignee);
      if (input.filter === 'overdue')
        filtered = filtered.filter(t => !t.completed && isOverdue(t.dueDate));
      else if (input.filter === 'due_today')
        filtered = filtered.filter(t => !t.completed && isDueToday(t.dueDate));
      else if (input.filter === 'upcoming')
        filtered = filtered.filter(
          t => !t.completed && !isOverdue(t.dueDate) && !isDueToday(t.dueDate),
        );
      // Trim the payload for Claude — full task list with all fields wastes
      // tokens. Keep id (so it can be referenced) plus the essentials.
      return {
        ok: true,
        count: filtered.length,
        tasks: filtered.map(t => ({
          id: t.id,
          title: t.title,
          priority: t.priority,
          category: t.category,
          assignee: t.assignee,
          dueDate: t.dueDate,
          completed: t.completed,
        })),
      };
    }

    case 'complete_task': {
      const tasks = await loadTasks();
      const idx = tasks.findIndex(t => t.id === input.id);
      if (idx === -1) return { ok: false, error: `No task with id ${input.id}` };
      tasks[idx] = { ...tasks[idx], completed: true };
      await saveTasks(tasks);
      return { ok: true, task: tasks[idx] };
    }

    case 'update_task': {
      const tasks = await loadTasks();
      const idx = tasks.findIndex(t => t.id === input.id);
      if (idx === -1) return { ok: false, error: `No task with id ${input.id}` };
      const { id, ...patch } = input;
      tasks[idx] = { ...tasks[idx], ...patch };
      await saveTasks(tasks);
      return { ok: true, task: tasks[idx] };
    }

    case 'delete_task': {
      const tasks = await loadTasks();
      const before = tasks.length;
      const next = tasks.filter(t => t.id !== input.id);
      if (next.length === before) return { ok: false, error: `No task with id ${input.id}` };
      await saveTasks(next);
      return { ok: true, deletedId: input.id };
    }

    case 'save_to_brain': {
      // Server-side save: hit our own JSON endpoint. We could call the
      // brain storage helpers directly, but going through the API keeps
      // one path for "save text to Brain" (works the same whether the
      // user clicked a bookmark or Roam-io decided to save).
      const baseUrl = process.env.URL || process.env.DEPLOY_PRIME_URL || 'http://localhost:3000';
      const res = await fetch(`${baseUrl}/api/brain/items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: input.content,
          tags: input.tags,
          description: input.description,
          source: 'roam-io-chat',
          autoFolder: true,
        }),
      });
      const data = await res.json();
      if (!data.ok) return { ok: false, error: data.error || 'Save failed' };
      return {
        ok: true,
        savedTo: data.item?.folderId ? 'Brain' : 'Brain (root)',
        description: data.item?.description,
        tags: data.item?.tags,
      };
    }

    // ===== Social tools ==================================================
    case 'list_briefs': {
      const briefs = (await getCollection<any[]>(DEFAULT_USER_ID, 'briefs')) || [];
      return {
        ok: true,
        count: briefs.length,
        briefs: briefs.map((b: any) => ({
          id: b.id,
          name: b.name,
          description: b.description,
          active: b.active !== false,
        })),
      };
    }

    case 'list_themes': {
      const baseUrl = process.env.URL || process.env.DEPLOY_PRIME_URL || 'http://localhost:3000';
      const settingsRes = await fetch(`${baseUrl}/api/social/settings`, {
        headers: process.env.CRON_SECRET_V2 ? { 'x-internal-call': process.env.CRON_SECRET_V2 } : {},
      }).catch(() => null);
      if (!settingsRes || !settingsRes.ok) return { ok: false, error: 'Could not load settings' };
      const data: any = await settingsRes.json();
      const themes: any[] = data?.themes || [];
      const onlyEnabled = input.onlyEnabled !== false;
      const filtered = themes
        .filter(t => Array.isArray(t.briefIds) && t.briefIds.includes(input.briefId))
        .filter(t => !onlyEnabled || t.enabled !== false);
      return {
        ok: true,
        count: filtered.length,
        themes: filtered.map(t => ({
          id: t.id,
          title: t.title,
          category: t.category,
          enabled: t.enabled !== false,
        })),
      };
    }

    case 'list_accounts': {
      const baseUrl = process.env.URL || process.env.DEPLOY_PRIME_URL || 'http://localhost:3000';
      const res = await fetch(`${baseUrl}/api/accounts/status`, {
        headers: process.env.CRON_SECRET_V2 ? { 'x-internal-call': process.env.CRON_SECRET_V2 } : {},
      }).catch(() => null);
      if (!res || !res.ok) return { ok: false, error: 'Could not load accounts' };
      const data: any = await res.json();
      // The route returns { linkedin, meta, realAccounts } — NOT accounts.
      // Reading the wrong key here was the patch-6 launch bug that made
      // Roam-io insist no accounts were connected.
      const realAccounts: any[] = data?.realAccounts || [];
      const metaCol = (await getCollection<any[]>(DEFAULT_USER_ID, 'account_meta')) || [];
      const result = realAccounts.map((a: any) => {
        const meta = metaCol.find((m: any) => m.accountId === a.id);
        // MULTI-BRIEF-V1: return the full briefIds list, with the legacy
        // single briefId kept (= briefIds[0]) for any Roam-io memories
        // saved before this patch that reference the old shape.
        const briefIds: string[] = (Array.isArray(meta?.briefIds) && meta.briefIds.length > 0)
          ? meta.briefIds
          : (meta?.briefId ? [meta.briefId] : []);
        return {
          id: a.id,
          platform: a.platform,
          type: a.type,
          handle: a.handle,
          region: a.region,
          briefIds,
          briefId: briefIds[0],
          active: meta?.active !== false,
          canPost: !!a.capabilities?.canPost,
        };
      });
      return { ok: true, count: result.length, accounts: result };
    }

    case 'list_social_posts': {
      const posts = (await getCollection<any[]>(DEFAULT_USER_ID, 'social_posts')) || [];
      let filtered = [...posts];
      if (input.status && input.status !== 'all') {
        filtered = filtered.filter((p: any) => p.status === input.status);
      }
      if (input.briefId) filtered = filtered.filter((p: any) => p.briefId === input.briefId);
      if (input.accountId) filtered = filtered.filter((p: any) => Array.isArray(p.accountIds) && p.accountIds.includes(input.accountId));
      if (input.from) {
        const fromT = new Date(input.from).getTime();
        filtered = filtered.filter((p: any) => new Date(p.scheduledAt).getTime() >= fromT);
      }
      if (input.to) {
        const toT = new Date(input.to).getTime();
        filtered = filtered.filter((p: any) => new Date(p.scheduledAt).getTime() <= toT);
      }
      filtered.sort((a: any, b: any) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime());
      const limit = Math.min(input.limit || 30, 100);
      return {
        ok: true,
        count: filtered.length,
        showing: Math.min(filtered.length, limit),
        posts: filtered.slice(0, limit).map((p: any) => ({
          id: p.id,
          status: p.status,
          scheduledAt: p.scheduledAt,
          captionPreview: (p.caption || '').slice(0, 100),
          accountIds: p.accountIds,
          briefId: p.briefId,
          hasImage: !!p.imageUrl,
        })),
      };
    }

    case 'get_post': {
      const posts = (await getCollection<any[]>(DEFAULT_USER_ID, 'social_posts')) || [];
      const p = posts.find((x: any) => x.id === input.id);
      if (!p) return { ok: false, error: `Post ${input.id} not found` };
      return {
        ok: true,
        post: {
          id: p.id,
          status: p.status,
          scheduledAt: p.scheduledAt,
          caption: p.caption,
          accountIds: p.accountIds,
          briefId: p.briefId,
          imageUrl: p.imageUrl,
          imageCredit: p.imageCredit,
          results: p.results,
          createdAt: p.createdAt,
        },
      };
    }

    case 'analyse_calendar': {
      const posts = (await getCollection<any[]>(DEFAULT_USER_ID, 'social_posts')) || [];
      const briefs = (await getCollection<any[]>(DEFAULT_USER_ID, 'briefs')) || [];
      const days = Math.min(input.days || 14, 60);
      const now = new Date();
      now.setHours(0, 0, 0, 0);
      const horizon = new Date(now);
      horizon.setDate(horizon.getDate() + days);

      const window = posts.filter((p: any) => {
        const t = new Date(p.scheduledAt).getTime();
        return t >= now.getTime() && t < horizon.getTime();
      });

      // Day buckets
      const byDay: Record<string, number> = {};
      for (let i = 0; i < days; i++) {
        const d = new Date(now);
        d.setDate(d.getDate() + i);
        byDay[d.toISOString().split('T')[0]] = 0;
      }
      const byBrief: Record<string, number> = {};
      const byAccount: Record<string, number> = {};
      for (const p of window) {
        const dk = new Date(p.scheduledAt).toISOString().split('T')[0];
        if (dk in byDay) byDay[dk]++;
        if (p.briefId) byBrief[p.briefId] = (byBrief[p.briefId] || 0) + 1;
        for (const a of (p.accountIds || [])) {
          byAccount[a] = (byAccount[a] || 0) + 1;
        }
      }

      const emptyDays = Object.entries(byDay).filter(([, c]) => c === 0).map(([d]) => d);
      const briefBreakdown = briefs.map((b: any) => ({
        briefId: b.id,
        name: b.name,
        count: byBrief[b.id] || 0,
      }));
      const totalPlanned = window.length;
      const draftCount = window.filter((p: any) => p.status === 'draft').length;
      const scheduledCount = window.filter((p: any) => p.status === 'scheduled').length;

      return {
        ok: true,
        windowDays: days,
        totalPlanned,
        draftCount,
        scheduledCount,
        emptyDays,
        briefBreakdown,
        byAccount,
      };
    }

    case 'create_post_draft': {
      const baseUrl = process.env.URL || process.env.DEPLOY_PRIME_URL || 'http://localhost:3000';
      const secret = process.env.CRON_SECRET_V2;
      if (!secret) return { ok: false, error: 'CRON_SECRET_V2 not configured' };
      const res = await fetch(`${baseUrl}/api/social/draft`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-internal-call': secret },
        body: JSON.stringify({
          briefId: input.briefId,
          accountId: input.accountId,
          themeId: input.themeId,
          scheduledAt: input.scheduledAt,
          withImage: input.withImage || 'none',
          captionOverride: input.captionOverride,
        }),
      });
      const data = await res.json().catch(() => ({ ok: false, error: 'Bad response' }));
      if (!data.ok) return { ok: false, error: data.error || 'Draft creation failed' };
      return {
        ok: true,
        postId: data.post?.id,
        scheduledAt: data.post?.scheduledAt,
        captionPreview: (data.post?.caption || '').slice(0, 100),
        hasImage: !!data.post?.imageUrl,
      };
    }

    case 'regenerate_caption': {
      // Find the post, then call /api/social/draft with captionOverride
      // omitted to force fresh generation, reusing the post's brief and
      // first account. Replace the post in place.
      const posts = (await getCollection<any[]>(DEFAULT_USER_ID, 'social_posts')) || [];
      const idx = posts.findIndex((p: any) => p.id === input.id);
      if (idx === -1) return { ok: false, error: `Post ${input.id} not found` };
      const old = posts[idx];
      const briefId = old.briefId;
      const accountId = Array.isArray(old.accountIds) ? old.accountIds[0] : null;
      if (!briefId || !accountId) {
        return { ok: false, error: 'Post is missing briefId or accountId' };
      }
      const baseUrl = process.env.URL || process.env.DEPLOY_PRIME_URL || 'http://localhost:3000';
      const secret = process.env.CRON_SECRET_V2;
      if (!secret) return { ok: false, error: 'CRON_SECRET_V2 not configured' };
      const res = await fetch(`${baseUrl}/api/social/draft`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-internal-call': secret },
        body: JSON.stringify({ briefId, accountId, scheduledAt: old.scheduledAt, withImage: 'none' }),
      });
      const data = await res.json().catch(() => ({ ok: false, error: 'Bad response' }));
      if (!data.ok) return { ok: false, error: data.error || 'Regenerate failed' };
      // Replace old post's caption with the new one, drop the freshly-created duplicate.
      const updatedCaption = data.post.caption;
      posts[idx] = { ...old, caption: updatedCaption };
      // The /draft endpoint already appended a new post — remove it.
      const filtered = posts.filter((p: any) => p.id !== data.post.id);
      await saveCollection(DEFAULT_USER_ID, 'social_posts', filtered);
      return { ok: true, id: input.id, captionPreview: updatedCaption.slice(0, 100) };
    }

    case 'reschedule_post': {
      const posts = (await getCollection<any[]>(DEFAULT_USER_ID, 'social_posts')) || [];
      const idx = posts.findIndex((p: any) => p.id === input.id);
      if (idx === -1) return { ok: false, error: `Post ${input.id} not found` };
      // Sanity-check the date.
      const t = new Date(input.scheduledAt).getTime();
      if (!Number.isFinite(t)) return { ok: false, error: 'Invalid scheduledAt' };
      posts[idx] = { ...posts[idx], scheduledAt: input.scheduledAt };
      await saveCollection(DEFAULT_USER_ID, 'social_posts', posts);
      return { ok: true, id: input.id, scheduledAt: input.scheduledAt };
    }

    case 'delete_post': {
      const posts = (await getCollection<any[]>(DEFAULT_USER_ID, 'social_posts')) || [];
      const before = posts.length;
      const next = posts.filter((p: any) => p.id !== input.id);
      if (next.length === before) return { ok: false, error: `Post ${input.id} not found` };
      await saveCollection(DEFAULT_USER_ID, 'social_posts', next);
      return { ok: true, deletedId: input.id };
    }

    case 'bulk_fill_calendar': {
      const baseUrl = process.env.URL || process.env.DEPLOY_PRIME_URL || 'http://localhost:3000';
      const secret = process.env.CRON_SECRET_V2;
      if (!secret) return { ok: false, error: 'CRON_SECRET_V2 not configured' };
      const lookaheadDays = Math.min(input.lookaheadDays || 7, 28);
      const res = await fetch(`${baseUrl}/api/social/auto-generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-internal-call': secret },
        body: JSON.stringify({ lookaheadDays }),
      });
      const data = await res.json().catch(() => ({ ok: false, error: 'Bad response' }));
      if (!data.ok) return { ok: false, error: data.error || 'Fill calendar failed' };
      return {
        ok: true,
        lookaheadDays,
        created: data.created || 0,
        accountsProcessed: data.accountsProcessed || 0,
      };
    }

    case 'plan_content_week': {
      // Strategic tool — does NOT create posts. Loads briefs + themes +
      // accounts and returns a structured proposal that Roam-io
      // summarises for the user.
      const briefs = (await getCollection<any[]>(DEFAULT_USER_ID, 'briefs')) || [];
      const baseUrl = process.env.URL || process.env.DEPLOY_PRIME_URL || 'http://localhost:3000';
      const secret = process.env.CRON_SECRET_V2;
      const [accountsRes, settingsRes] = await Promise.all([
        fetch(`${baseUrl}/api/accounts/status`, { headers: secret ? { 'x-internal-call': secret } : {} }).catch(() => null),
        fetch(`${baseUrl}/api/social/settings`, { headers: secret ? { 'x-internal-call': secret } : {} }).catch(() => null),
      ]);
      const accountsData: any = accountsRes && accountsRes.ok ? await accountsRes.json() : { realAccounts: [] };
      const settingsData: any = settingsRes && settingsRes.ok ? await settingsRes.json() : { themes: [] };
      // Use realAccounts (the route's shape), not accounts.
      const accounts: any[] = (accountsData.realAccounts || []).filter((a: any) => a.capabilities?.canPost);
      const themes: any[] = settingsData.themes || [];
      const metaCol = (await getCollection<any[]>(DEFAULT_USER_ID, 'account_meta')) || [];

      const days = Math.min(input.days || 7, 14);
      const focus = input.focusBriefId;

      // Build proposed slots: one per active account per day for `days` days.
      const proposed: any[] = [];
      const start = new Date();
      start.setHours(9, 0, 0, 0);
      start.setDate(start.getDate() + 1); // start tomorrow
      for (let d = 0; d < days; d++) {
        const dayDate = new Date(start);
        dayDate.setDate(start.getDate() + d);
        for (const acc of accounts) {
          const meta = metaCol.find((m: any) => m.accountId === acc.id);
          let briefId = meta?.briefId;
          // If focus brief specified, override every other day to focus brief.
          if (focus && d % 2 === 0) briefId = focus;
          if (!briefId) continue;
          const brief = briefs.find((b: any) => b.id === briefId);
          if (!brief) continue;
          const themePool = themes.filter((t: any) => t.enabled && Array.isArray(t.briefIds) && t.briefIds.includes(briefId));
          const theme = themePool[Math.floor(Math.random() * themePool.length)];
          proposed.push({
            day: dayDate.toISOString().split('T')[0],
            time: '09:00',
            account: acc.handle,
            accountId: acc.id,
            platform: acc.platform,
            briefId,
            briefName: brief.name,
            themeId: theme?.id,
            themeTitle: theme?.title,
            topicHint: input.topic || theme?.title || brief.name,
          });
        }
      }

      return {
        ok: true,
        days,
        topic: input.topic,
        focusBriefId: focus,
        slotCount: proposed.length,
        proposed,
        note: 'This is a proposal only. Nothing has been created. The user must explicitly say "yes, create these" before you call create_post_draft for each slot.',
      };
    }

    default:
      return { ok: false, error: `Unknown tool: ${name}` };
  }
}
