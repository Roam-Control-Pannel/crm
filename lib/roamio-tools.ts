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
};

// =================================================================
// Toolset registry — chat route picks which schemas to send based on
// the `tools` array in the request body. Add new toolsets here.
// =================================================================
const TOOLSETS: Record<string, any[]> = {
  tasks: TASK_TOOLS,
  brain: BRAIN_TOOLS,
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

    default:
      return { ok: false, error: `Unknown tool: ${name}` };
  }
}
