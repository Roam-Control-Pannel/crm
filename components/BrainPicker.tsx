'use client';
import { useState, useEffect, useMemo } from 'react';
import { X, Search, Image as ImageIcon, Brain as BrainIcon } from 'lucide-react';
import { BrainItem, Folder, fetchFolders, fetchItems, searchItems, imageUrl } from '@/lib/brain';

interface BrainPickerProps {
  open: boolean;
  onClose: () => void;
  onPick: (item: BrainItem) => void;
}

const inp = {
  width: '100%', padding: '8px 12px', border: '1.5px solid var(--ink-200)',
  borderRadius: 'var(--r-sm)', fontSize: 13, fontFamily: 'inherit', background: 'var(--white)',
} as const;

const btnG = {
  padding: '6px 12px', borderRadius: 'var(--r-sm)', border: '1.5px solid var(--ink-200)',
  background: 'var(--white)', fontSize: 11, fontWeight: 500, color: 'var(--ink-700)',
  cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5, fontFamily: 'inherit',
} as const;

export default function BrainPicker({ open, onClose, onPick }: BrainPickerProps) {
  const [folders, setFolders] = useState<Folder[]>([]);
  const [items, setItems] = useState<BrainItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [folderFilter, setFolderFilter] = useState<string>(''); // '' = all
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    Promise.all([fetchFolders(), fetchItems()]).then(([f, i]) => {
      setFolders(f);
      setItems(i);
      setLoading(false);
    });
  }, [open]);

  const visibleItems = useMemo(() => {
    let list = items;
    if (folderFilter) {
      list = list.filter(i => i.folderId === folderFilter);
    }
    if (search.trim()) {
      list = searchItems(list, search);
    }
    return list.sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
  }, [items, folderFilter, search]);

  if (!open) return null;

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(26,13,18,0.6)', zIndex: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{ background: 'var(--white)', borderRadius: 'var(--r-xl)', width: 720, maxWidth: '100%', maxHeight: '85vh', display: 'flex', flexDirection: 'column', boxShadow: 'var(--shadow-lg)' }}>
        {/* Header */}
        <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--ink-100)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <BrainIcon size={18} color="var(--maroon-700)" />
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, color: 'var(--ink-900)' }}>Pick from Brain</div>
          </div>
          <button onClick={onClose} style={{ ...btnG, padding: '4px 8px' }}><X size={13} /></button>
        </div>

        {/* Filters */}
        <div style={{ padding: '12px 18px', borderBottom: '1px solid var(--ink-100)', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', flexShrink: 0 }}>
          <div style={{ position: 'relative', flex: 1, minWidth: 180 }}>
            <Search size={13} color="var(--ink-400)" style={{ position: 'absolute', top: '50%', left: 10, transform: 'translateY(-50%)' }} />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search by tag or description"
              style={{ ...inp, paddingLeft: 32, fontSize: 12 }}
            />
          </div>
          <select
            value={folderFilter}
            onChange={e => setFolderFilter(e.target.value)}
            style={{ ...inp, width: 'auto', fontSize: 12, padding: '7px 10px', cursor: 'pointer' }}
          >
            <option value="">All folders</option>
            {folders.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
        </div>

        {/* Body */}
        <div style={{ padding: 18, overflowY: 'auto', flex: 1 }}>
          {loading ? (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--ink-400)', fontSize: 12 }}>Loading…</div>
          ) : visibleItems.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center' }}>
              <ImageIcon size={28} color="var(--ink-200)" style={{ margin: '0 auto 10px', display: 'block' }} />
              <div style={{ fontSize: 13, color: 'var(--ink-700)', marginBottom: 4, fontWeight: 500 }}>
                {search ? 'No matches' : items.length === 0 ? 'Your brain is empty' : 'No items here'}
              </div>
              <div style={{ fontSize: 11, color: 'var(--ink-500)', maxWidth: 320, margin: '0 auto' }}>
                {items.length === 0
                  ? 'Upload images to your Brain first — Roam-io will tag them automatically.'
                  : 'Try a different folder or clear the search.'}
              </div>
              {items.length === 0 && (
                <a href="/brain" style={{ display: 'inline-block', marginTop: 14, fontSize: 12, color: 'var(--maroon-700)', fontWeight: 600 }}>
                  Open Brain →
                </a>
              )}
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 10 }}>
              {visibleItems.map(item => (
                <div
                  key={item.id}
                  onClick={() => { onPick(item); onClose(); }}
                  style={{ background: 'var(--white)', border: '1.5px solid var(--ink-100)', borderRadius: 'var(--r-md)', overflow: 'hidden', cursor: 'pointer', transition: 'all 0.15s' }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--maroon-700)'; e.currentTarget.style.transform = 'translateY(-1px)'; }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--ink-100)'; e.currentTarget.style.transform = 'translateY(0)'; }}
                >
                  <div style={{ width: '100%', height: 100, background: 'var(--paper)' }}>
                    <img src={imageUrl(item)} alt={item.description} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  </div>
                  <div style={{ padding: 8 }}>
                    <div style={{ fontSize: 10, color: 'var(--ink-700)', lineHeight: 1.3, height: 26, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                      {item.description || <em style={{ color: 'var(--ink-400)' }}>No description</em>}
                    </div>
                    {item.tags.length > 0 && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 2, marginTop: 4 }}>
                        {item.tags.slice(0, 2).map(t => (
                          <span key={t} style={{ fontSize: 8, background: 'var(--paper)', padding: '1px 5px', borderRadius: 'var(--r-pill)', color: 'var(--ink-500)' }}>
                            {t}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: '10px 18px', borderTop: '1px solid var(--ink-100)', fontSize: 11, color: 'var(--ink-500)', textAlign: 'center', flexShrink: 0 }}>
          {visibleItems.length} item{visibleItems.length === 1 ? '' : 's'} · Click any to attach to your post
        </div>
      </div>
    </div>
  );
}
