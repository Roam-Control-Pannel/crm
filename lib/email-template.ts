/**
 * Editable outreach email templates + the renderer that turns them into the
 * branded HTML that actually goes out via Brevo.
 *
 * The /sequences page lets the user edit each step's subject, body and CTA as
 * plain text containing placeholder tokens. Both send paths — the manual
 * intro send (/api/brevo/send) and the daily cron (/api/sequences) — render
 * those templates through `renderSequenceEmail` so what you edit is what gets
 * sent. The branded wrapper (Arial frame, maroon CTA button, signature) is
 * applied automatically so the editor only ever deals with prose.
 *
 * This module is intentionally free of any Netlify / network imports so it can
 * be imported from anywhere (routes, future tests) cheaply.
 */

export type SequenceStep = 1 | 2 | 3;

export interface StepTemplate {
  /** Email subject line. Plain text, supports tokens. */
  subject: string;
  /** Email body prose. Plain text, blank lines = paragraphs, supports tokens. */
  body: string;
  /** Call-to-action button label (an arrow is appended automatically). */
  cta: string;
}

export interface SequenceTemplates {
  step1: StepTemplate;
  step2: StepTemplate;
  step3: StepTemplate;
}

/** Variables available to templates, with the token used to reference each. */
export interface TemplateVars {
  businessName: string;
  town: string;
  knownFor: string;
}

/** Tokens the editor can use, surfaced in the UI as a hint. */
export const TEMPLATE_TOKENS = ['[Business]', '[Town]', '[known_for]'] as const;

/** Where every CTA button points. Mirrors the "Links to" setting on the page. */
export const SEQUENCE_LINK = 'https://roam-local.co.uk';

/**
 * Defaults mirror the previously-hardcoded copy so an empty blob preserves
 * existing behaviour. Bold emphasis on business/town names is applied
 * automatically at render time wherever those tokens appear.
 */
export const DEFAULT_SEQUENCE_TEMPLATES: SequenceTemplates = {
  step1: {
    subject: 'Free listing for [Business] on Roam',
    body:
      "Hi there,\n\n" +
      "We've built a dedicated page for [Town] on Roam — a free local discovery app helping people find the best independent businesses in their area.\n\n" +
      "[Town] is known for [known_for], and we'd love [Business] to be one of the first businesses featured.\n\n" +
      "Listing takes 90 seconds and is completely free — no subscription, no catch.\n\n" +
      "Any questions, just reply to this email.\n\n" +
      "Best wishes,",
    cta: 'List [Business] for free',
  },
  step2: {
    subject: 'Just checking in — [Town] on Roam',
    body:
      "Hi there,\n\n" +
      "Just a quick follow-up — we'd love to have [Business] on Roam's [Town] page.\n\n" +
      "It's completely free and takes 90 seconds. Businesses across [Town] are already signing up.\n\n" +
      "Best wishes,",
    cta: 'Get listed now',
  },
  step3: {
    subject: 'Last one from us — [Business]',
    body:
      "Hi there,\n\n" +
      "We won't chase again after this — promise!\n\n" +
      "If you'd like [Business] featured on Roam's [Town] page for free, it only takes 90 seconds.\n\n" +
      "Best wishes,",
    cta: 'List for free',
  },
};

const SIGNATURE = `
<table style="margin-top:24px;padding-top:16px;border-top:1px solid #e4d8dc;font-family:Arial,sans-serif">
  <tr>
    <td style="padding-right:16px;vertical-align:top">
      <img src="https://roam-local.co.uk/icon.png" width="40" height="40" style="border-radius:8px" alt="Roam"/>
    </td>
    <td style="vertical-align:top">
      <div style="font-weight:700;font-size:13px;color:#1a0d12">Roam Local Team</div>
      <div style="font-size:12px;color:#6b4a55;margin-top:2px">Discover the best of your town</div>
      <div style="margin-top:6px">
        <a href="https://roam-local.co.uk" style="font-size:11px;color:#8B1A3A;text-decoration:none;font-family:Arial,sans-serif">roam-local.co.uk</a>
        <span style="color:#e4d8dc;margin:0 6px">|</span>
        <a href="https://roam-local.co.uk" style="font-size:11px;color:#8B1A3A;text-decoration:none;font-family:Arial,sans-serif">List your business free</a>
      </div>
    </td>
  </tr>
</table>`;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Replace tokens in a plain-text string (no HTML, used for the subject). */
function fillPlain(text: string, vars: TemplateVars): string {
  return text
    .split('[Business]').join(vars.businessName)
    .split('[Town]').join(vars.town)
    .split('[known_for]').join(vars.knownFor);
}

/**
 * Replace tokens in HTML context: everything is escaped, and business/town
 * names are wrapped in <strong> to match the original branded emails.
 */
function fillHtml(text: string, vars: TemplateVars): string {
  return escapeHtml(text)
    .split('[Business]').join(`<strong>${escapeHtml(vars.businessName)}</strong>`)
    .split('[Town]').join(`<strong>${escapeHtml(vars.town)}</strong>`)
    .split('[known_for]').join(escapeHtml(vars.knownFor));
}

/** Turn a plain-text body into HTML paragraphs (blank line = new <p>). */
function bodyToHtml(body: string, vars: TemplateVars): string {
  return body
    .split(/\n{2,}/)
    .map(p => p.trim())
    .filter(Boolean)
    .map(p => `<p>${fillHtml(p, vars).split('\n').join('<br/>')}</p>`)
    .join('\n');
}

/**
 * Render an editable step template into the subject + branded HTML that Brevo
 * sends. Tokens are interpolated, the CTA becomes a maroon button, and the
 * Roam signature is appended.
 */
export function renderSequenceEmail(
  tpl: StepTemplate,
  vars: TemplateVars
): { subject: string; htmlContent: string } {
  const subject = fillPlain(tpl.subject, vars).trim();
  const bodyHtml = bodyToHtml(tpl.body, vars);
  const ctaLabel = fillHtml(tpl.cta || '', vars).trim();
  const ctaHtml = ctaLabel
    ? `<p style="margin-top:20px"><a href="${SEQUENCE_LINK}" style="background:#8B1A3A;color:white;padding:12px 24px;border-radius:6px;text-decoration:none;display:inline-block;font-weight:700;font-family:Arial,sans-serif">${ctaLabel} →</a></p>`
    : '';
  const htmlContent = `<div style="font-family:Arial,sans-serif;max-width:560px;color:#1a0d12">${bodyHtml}${ctaHtml}${SIGNATURE}</div>`;
  return { subject, htmlContent };
}

/** Coerce arbitrary input into a valid StepTemplate, falling back per-field. */
export function sanitizeStepTemplate(input: unknown, fallback: StepTemplate): StepTemplate {
  const o = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const str = (v: unknown, fb: string) => (typeof v === 'string' ? v : fb);
  return {
    subject: str(o.subject, fallback.subject),
    body: str(o.body, fallback.body),
    cta: str(o.cta, fallback.cta),
  };
}
