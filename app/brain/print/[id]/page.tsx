'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';

/**
 * Print-friendly view of a Brain document. Linked from the Brain page's
 * "Download as PDF" button — opens in a new window so the user can hit
 * print-to-PDF in their browser. The CSS hides chrome on print so the
 * resulting PDF is just the document body.
 */
export default function BrainPrintPage() {
  const params = useParams<{ id: string }>();
  const [doc, setDoc] = useState<{ description: string; content: string; tags: string[]; uploadedAt: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!params?.id) return;
    fetch(`/api/brain/items/${params.id}/content`)
      .then(r => r.json())
      .then(d => {
        if (!d.ok) { setError(d.error || 'Could not load'); return; }
        if (d.binary) { setError('This item is binary — open the original file instead.'); return; }
        setDoc({
          description: d.item?.description || 'Untitled',
          content: d.content || '',
          tags: d.item?.tags || [],
          uploadedAt: d.item?.uploadedAt || '',
        });
      })
      .catch(() => setError('Network error'));
  }, [params?.id]);

  // Open the system print dialog automatically once the content lands. Users
  // arrived here by clicking "Download as PDF" so the auto-prompt matches intent.
  useEffect(() => {
    if (doc) {
      const t = setTimeout(() => window.print(), 350);
      return () => clearTimeout(t);
    }
  }, [doc]);

  if (error) {
    return <div style={{ padding: 40, fontFamily: 'system-ui', color: '#b53939' }}>{error}</div>;
  }
  if (!doc) {
    return <div style={{ padding: 40, fontFamily: 'system-ui', color: '#888' }}>Loading…</div>;
  }

  return (
    <div className="print-wrap">
      <div className="print-toolbar no-print">
        <button onClick={() => window.print()}>Print / Save as PDF</button>
        <button onClick={() => window.close()}>Close</button>
      </div>
      <article className="print-doc">
        <header className="print-head">
          <div className="print-eyebrow">Roam-io Brain</div>
          <h1>{doc.description}</h1>
          <div className="print-meta">
            {doc.uploadedAt && <span>{new Date(doc.uploadedAt).toLocaleDateString('en-GB', { timeZone: 'Europe/London', day: 'numeric', month: 'long', year: 'numeric' })}</span>}
            {doc.tags.length > 0 && <span> · {doc.tags.join(' · ')}</span>}
          </div>
        </header>
        <div className="print-body" dangerouslySetInnerHTML={{ __html: renderMarkdown(doc.content) }} />
      </article>

      <style jsx global>{`
        body { background: #f4eee9; margin: 0; }
        .print-wrap { font-family: 'Georgia', 'Times New Roman', serif; color: #1a0d12; }
        .print-toolbar {
          position: sticky; top: 0; background: #fff;
          padding: 12px 18px; border-bottom: 1px solid #e4d8dc;
          display: flex; gap: 8px; z-index: 10;
        }
        .print-toolbar button {
          padding: 7px 14px; font-size: 13px; font-weight: 600;
          background: #8B1A3A; color: #fff; border: none; border-radius: 6px;
          cursor: pointer; font-family: 'Nunito Sans', sans-serif;
        }
        .print-toolbar button:nth-of-type(2) { background: transparent; color: #8B1A3A; border: 1px solid #d4c0c6; }
        .print-doc {
          max-width: 720px; margin: 32px auto; padding: 56px 64px;
          background: #fff; border-radius: 4px; box-shadow: 0 4px 18px rgba(0,0,0,0.06);
          line-height: 1.7;
        }
        .print-head { border-bottom: 1px solid #e4d8dc; padding-bottom: 18px; margin-bottom: 24px; }
        .print-eyebrow { font-size: 10px; letter-spacing: 0.18em; text-transform: uppercase; color: #9e7e88; font-family: 'Nunito Sans', sans-serif; font-weight: 700; margin-bottom: 4px; }
        .print-head h1 { font-size: 28px; line-height: 1.2; margin: 0 0 8px; color: #1a0d12; font-weight: 700; }
        .print-meta { font-size: 11px; color: #9e7e88; font-family: 'Nunito Sans', sans-serif; }
        .print-body h1 { font-size: 22px; margin: 28px 0 10px; font-weight: 700; }
        .print-body h2 { font-size: 18px; margin: 24px 0 8px; font-weight: 700; color: #8B1A3A; }
        .print-body h3 { font-size: 15px; margin: 20px 0 6px; font-weight: 700; }
        .print-body p { margin: 0 0 14px; font-size: 14.5px; }
        .print-body ul, .print-body ol { margin: 0 0 14px; padding-left: 24px; }
        .print-body li { margin-bottom: 4px; font-size: 14.5px; }
        .print-body code { background: #f4eee9; padding: 2px 5px; border-radius: 3px; font-size: 13px; }
        .print-body pre { background: #f4eee9; padding: 12px 14px; border-radius: 6px; overflow-x: auto; font-size: 13px; }
        .print-body strong { font-weight: 700; }
        .print-body em { font-style: italic; }
        .print-body blockquote { border-left: 3px solid #8B1A3A; padding-left: 14px; color: #6b4a55; margin: 0 0 14px; }
        .print-body a { color: #8B1A3A; }
        @media print {
          body { background: #fff; }
          .no-print { display: none !important; }
          .print-doc { margin: 0; padding: 0; box-shadow: none; max-width: 100%; }
        }
      `}</style>
    </div>
  );
}

/**
 * Tiny markdown-to-HTML renderer. Covers what generate_document produces:
 * headings, paragraphs, bold/italic, lists, code, links, blockquotes. No
 * dependency on a markdown library — keeps the bundle small and the
 * output predictable.
 */
function renderMarkdown(md: string): string {
  const escape = (s: string) => s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' } as any)[c]);
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^```/.test(line)) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) { buf.push(lines[i]); i++; }
      i++;
      out.push(`<pre><code>${escape(buf.join('\n'))}</code></pre>`);
      continue;
    }
    if (/^\s*#\s+/.test(line)) { out.push(`<h1>${inline(escape(line.replace(/^\s*#\s+/, '')))}</h1>`); i++; continue; }
    if (/^\s*##\s+/.test(line)) { out.push(`<h2>${inline(escape(line.replace(/^\s*##\s+/, '')))}</h2>`); i++; continue; }
    if (/^\s*###\s+/.test(line)) { out.push(`<h3>${inline(escape(line.replace(/^\s*###\s+/, '')))}</h3>`); i++; continue; }
    if (/^\s*>\s?/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) { buf.push(lines[i].replace(/^\s*>\s?/, '')); i++; }
      out.push(`<blockquote>${inline(escape(buf.join(' ')))}</blockquote>`);
      continue;
    }
    if (/^\s*[-*]\s+/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) { buf.push(lines[i].replace(/^\s*[-*]\s+/, '')); i++; }
      out.push('<ul>' + buf.map(b => `<li>${inline(escape(b))}</li>`).join('') + '</ul>');
      continue;
    }
    if (/^\s*\d+\.\s+/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) { buf.push(lines[i].replace(/^\s*\d+\.\s+/, '')); i++; }
      out.push('<ol>' + buf.map(b => `<li>${inline(escape(b))}</li>`).join('') + '</ol>');
      continue;
    }
    if (line.trim() === '') { i++; continue; }
    // Paragraph: greedy until a blank or block-start line.
    const buf: string[] = [line];
    i++;
    while (i < lines.length && lines[i].trim() !== '' && !/^\s*(#|>|[-*]\s|\d+\.\s|```)/.test(lines[i])) {
      buf.push(lines[i]); i++;
    }
    out.push(`<p>${inline(escape(buf.join(' ')))}</p>`);
  }
  return out.join('\n');
}

function inline(s: string): string {
  return s
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
}
