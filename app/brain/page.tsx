'use client';
import { useState, useEffect, useMemo, useRef } from 'react';
import Link from 'next/link';
import { Plus, FolderPlus, Folder as FolderIcon, ChevronRight, Upload, X, Edit3, Trash2, Search, Brain as BrainIcon, ChevronDown, Image as ImageIcon, Loader, FileText, Download, Printer, Sparkles, ExternalLink } from 'lucide-react';
import {
  Folder, BrainItem, FolderNode,
  fetchFolders, createFolder, renameFolder, deleteFolder,
  fetchItems, uploadItem, updateItem, deleteItem,
  buildFolderTree, getFolderPath, searchItems, imageUrl,
} from '@/lib/brain';

const inp = {
  width: '100%', padding: '8px 12px', border: '1.5px solid var(--ink-200)',
  borderRadius: 'var(--r-sm)', fontSize: 13, fontFamily: 'inherit', background: 'var(--white)',
} as const;

const btnG = {
  padding: '7px 14px', borderRadius: 'var(--r-sm)', border: '1.5px solid var(--ink-200)',
  background: 'var(--white)', fontSize: 12, fontWeight: 500, color: 'var(--ink-700)',
  cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: 'inherit',
} as const;

const btnP = {
  padding: '7px 14px', borderRadius: 'var(--r-sm)', border: 'none',
  background: 'var(--maroon-700)', color: 'var(--white)', fontSize: 12, fontWeight: 600,
  cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: 'inherit',
} as const;

export default function BrainPage() {
  const [folders, setFolders] = useState<Folder[]>([]);
  const [items, setItems] = useState<BrainItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null); // null = root
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');

  const [editing, setEditing] = useState<BrainItem | null>(null);
  const [editForm, setEditForm] = useState({ tags: '', description: '', folderId: '' });
  // Lazy-loaded text content for the currently-open item (markdown/text only).
  // Cleared whenever the modal closes so we don't carry stale text across opens.
  const [previewContent, setPreviewContent] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const [creatingFolder, setCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');

  const [uploading, setUploading] = useState(0); // count of in-flight uploads
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Initial load
  async function load() {
    setLoading(true);
    const [f, i] = await Promise.all([fetchFolders(), fetchItems()]);
    setFolders(f);
    setItems(i);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  const tree = useMemo(() => buildFolderTree(folders, items), [folders, items]);
  const breadcrumb = useMemo(() => getFolderPath(folders, currentFolderId), [folders, currentFolderId]);

  // Items shown = currentFolder's items, optionally search-filtered
  const visibleItems = useMemo(() => {
    let list = items;
    if (search.trim()) {
      list = searchItems(items, search);
    } else if (currentFolderId) {
      list = items.filter(i => i.folderId === currentFolderId);
    } else {
      list = items.filter(i => !i.folderId);
    }
    return list.sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
  }, [items, search, currentFolderId]);

  function toggleExpand(id: string) {
    setExpandedFolders(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleCreateFolder() {
    if (!newFolderName.trim()) return;
    const f = await createFolder(newFolderName.trim(), currentFolderId);
    if (f) {
      setFolders(prev => [...prev, f]);
      setNewFolderName('');
      setCreatingFolder(false);
    }
  }

  async function handleDeleteFolder(id: string, name: string) {
    if (!confirm(`Delete folder "${name}" and everything in it? This cannot be undone.`)) return;
    const ok = await deleteFolder(id);
    if (ok) await load();
  }

  async function handleRenameFolder(id: string, currentName: string) {
    const newName = prompt('Rename folder:', currentName);
    if (!newName || newName.trim() === currentName) return;
    const ok = await renameFolder(id, newName.trim());
    if (ok) setFolders(prev => prev.map(f => f.id === id ? { ...f, name: newName.trim() } : f));
  }

  async function handleUpload(files: FileList | null) {
    if (!files || files.length === 0) return;
    const arr = Array.from(files);
    setUploading(arr.length);
    for (const file of arr) {
      try {
        const item = await uploadItem(file, currentFolderId);
        if (item) setItems(prev => [item, ...prev]);
      } catch (e: any) {
        console.error('upload error', file.name, e);
        alert(`Failed to upload ${file.name}: ${e.message || e}`);
      } finally {
        setUploading(n => Math.max(0, n - 1));
      }
    }
  }

  function openEdit(item: BrainItem) {
    setEditing(item);
    setEditForm({
      tags: item.tags.join(', '),
      description: item.description,
      folderId: item.folderId || '',
    });
  }

  // Fetch the body of the open item when it's a markdown/text item, so the
  // user can actually read what's been saved. Binary items use the existing
  // iframe preview path.
  useEffect(() => {
    if (!editing) { setPreviewContent(null); return; }
    const mime = editing.mime || '';
    const isText = mime === 'text/markdown' || mime === 'text/plain' || mime.startsWith('text/');
    if (!isText) { setPreviewContent(null); return; }
    let cancelled = false;
    setPreviewLoading(true);
    fetch(`/api/brain/items/${editing.id}/content`)
      .then(r => r.json())
      .then(d => { if (!cancelled) setPreviewContent(d.ok ? (d.content || '') : null); })
      .catch(() => { if (!cancelled) setPreviewContent(null); })
      .finally(() => { if (!cancelled) setPreviewLoading(false); });
    return () => { cancelled = true; };
  }, [editing?.id, editing?.mime]);

  async function downloadAsMarkdown(item: BrainItem) {
    const res = await fetch(`/api/brain/items/${item.id}/content`);
    const d = await res.json();
    if (!d.ok || d.binary) return;
    const blob = new Blob([d.content || ''], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(item.description || 'document').replace(/[^a-z0-9-_ ]/gi, '').trim() || 'document'}.md`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function saveEdit() {
    if (!editing) return;
    const tags = editForm.tags.split(',').map(t => t.trim()).filter(Boolean);
    const ok = await updateItem(editing.id, {
      tags,
      description: editForm.description,
      folderId: editForm.folderId || null,
    });
    if (ok) {
      setItems(prev => prev.map(i => i.id === editing.id
        ? { ...i, tags, description: editForm.description, folderId: editForm.folderId || null }
        : i));
      setEditing(null);
    }
  }

  async function handleDeleteItem(item: BrainItem) {
    if (!confirm('Delete this item? It will be removed from the brain permanently.')) return;
    const ok = await deleteItem(item.id);
    if (ok) {
      setItems(prev => prev.filter(i => i.id !== item.id));
      if (editing?.id === item.id) setEditing(null);
    }
  }

  // Recursive folder tree renderer
  function renderTree(nodes: FolderNode[], depth = 0) {
    return nodes.map(node => {
      const isOpen = expandedFolders.has(node.folder.id);
      const isCurrent = currentFolderId === node.folder.id;
      const hasChildren = node.children.length > 0;
      return (
        <div key={node.folder.id}>
          <div
            style={{
              display: 'flex', alignItems: 'center', gap: 4,
              padding: '5px 8px', borderRadius: 'var(--r-sm)',
              cursor: 'pointer', marginLeft: depth * 14,
              background: isCurrent ? 'var(--maroon-700)' : 'transparent',
              color: isCurrent ? 'var(--white)' : 'var(--ink-700)',
              fontSize: 12, fontWeight: isCurrent ? 600 : 500,
            }}
            onClick={() => setCurrentFolderId(node.folder.id)}
          >
            <button
              onClick={e => { e.stopPropagation(); if (hasChildren) toggleExpand(node.folder.id); }}
              style={{ background: 'none', border: 'none', cursor: hasChildren ? 'pointer' : 'default', padding: 0, color: 'inherit', display: 'flex', alignItems: 'center', visibility: hasChildren ? 'visible' : 'hidden' }}
            >
              {isOpen ? <ChevronDown size={11}/> : <ChevronRight size={11}/>}
            </button>
            <FolderIcon size={13} style={{ flexShrink: 0 }}/>
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{node.folder.name}</span>
            <span style={{ fontSize: 10, opacity: 0.6 }}>{node.itemCount}</span>
          </div>
          {isOpen && hasChildren && renderTree(node.children, depth + 1)}
        </div>
      );
    });
  }

  return (
    <div className="brain-page" style={{ padding: '24px 28px' }}>
      {/* Header */}
      <div className="brain-header" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20, gap: 16 }}>
        <div className="brain-header-text">
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 700, color: 'var(--ink-900)', lineHeight: 1, display: 'flex', alignItems: 'center', gap: 10 }}>
            <BrainIcon size={26} color="var(--maroon-700)"/>
            Roam-io Brain
          </h1>
          <p style={{ fontSize: 12, color: 'var(--ink-400)', marginTop: 5, fontWeight: 500, maxWidth: 640 }}>
            Your knowledge base. Upload images and Roam-io will tag them automatically. The richer the brain, the smarter the AI generation.
          </p>
        </div>
        <div className="brain-header-actions" style={{ display: 'flex', gap: 8, flexShrink: 0, flexWrap: 'wrap' }}>
          <Link
            href="/hub?prompt=Draft%20a%20new%20document%20based%20on%20what%27s%20in%20my%20Brain.%20Search%20first%2C%20then%20write%20it."
            style={{ ...btnG, color: 'var(--maroon-700)', borderColor: 'var(--maroon-200, #d4c0c6)', textDecoration: 'none' }}
            title="Open Roam-io with a doc-writing prompt"
          >
            <Sparkles size={13}/> Generate with Roam-io
          </Link>
          <button onClick={() => setCreatingFolder(true)} style={btnG}><FolderPlus size={13}/> New folder</button>
          <button onClick={() => fileInputRef.current?.click()} style={btnP} disabled={uploading > 0}>
            {uploading > 0 ? <><Loader size={13} className="spin"/> Uploading {uploading}…</> : <><Upload size={13}/> Upload</>}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,application/pdf,.md,.txt,.markdown"
            multiple
            onChange={async e => {
              const files = e.target.files;
              await handleUpload(files);
              e.target.value = '';
            }}
            style={{ display: 'none' }}
          />
        </div>
      </div>

      {/* Body: 2-column grid */}
      <div className="brain-layout" style={{ display: 'grid', gridTemplateColumns: '240px 1fr', gap: 20 }}>
        {/* LEFT: Folder tree */}
        <div className="brain-sidebar" style={{ background: 'var(--white)', borderRadius: 'var(--r-lg)', padding: 12, boxShadow: 'var(--shadow-sm)', height: 'fit-content', position: 'sticky', top: 20 }}>
          {/* Root selector */}
          <div
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '6px 8px', borderRadius: 'var(--r-sm)',
              cursor: 'pointer', marginBottom: 4,
              background: currentFolderId === null ? 'var(--maroon-700)' : 'transparent',
              color: currentFolderId === null ? 'var(--white)' : 'var(--ink-700)',
              fontSize: 12, fontWeight: 600,
            }}
            onClick={() => setCurrentFolderId(null)}
          >
            <BrainIcon size={13}/> All items
            <span style={{ marginLeft: 'auto', fontSize: 10, opacity: 0.6 }}>{items.length}</span>
          </div>

          {creatingFolder && (
            <div style={{ display: 'flex', gap: 4, marginBottom: 6, marginLeft: 14 }}>
              <input
                autoFocus
                value={newFolderName}
                onChange={e => setNewFolderName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleCreateFolder(); if (e.key === 'Escape') { setCreatingFolder(false); setNewFolderName(''); } }}
                placeholder="Folder name"
                style={{ ...inp, fontSize: 11, padding: '4px 8px' }}
              />
            </div>
          )}

          {tree.length === 0 && !loading && !creatingFolder && (
            <div style={{ fontSize: 11, color: 'var(--ink-400)', padding: '8px', fontStyle: 'italic' }}>
              No folders yet. Click <strong>New folder</strong> to organise.
            </div>
          )}
          {renderTree(tree)}

          {/* Folder actions for the currently selected folder */}
          {currentFolderId && (() => {
            const f = folders.find(x => x.id === currentFolderId);
            if (!f) return null;
            return (
              <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--ink-100)', display: 'flex', flexDirection: 'column', gap: 4 }}>
                <button onClick={() => handleRenameFolder(f.id, f.name)} style={{ ...btnG, fontSize: 11, padding: '5px 8px', justifyContent: 'flex-start' }}>
                  <Edit3 size={11}/> Rename
                </button>
                <button onClick={() => { setCreatingFolder(true); }} style={{ ...btnG, fontSize: 11, padding: '5px 8px', justifyContent: 'flex-start' }}>
                  <FolderPlus size={11}/> New subfolder
                </button>
                <button onClick={() => handleDeleteFolder(f.id, f.name)} style={{ ...btnG, fontSize: 11, padding: '5px 8px', justifyContent: 'flex-start', color: 'var(--alert)' }}>
                  <Trash2 size={11}/> Delete folder
                </button>
              </div>
            );
          })()}
        </div>

        {/* RIGHT: Item grid */}
        <div>
          {/* Search + breadcrumb */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--ink-600)', flex: 1, minWidth: 200 }}>
              <BrainIcon size={13} color="var(--ink-400)"/>
              <button onClick={() => setCurrentFolderId(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: currentFolderId ? 'var(--maroon-700)' : 'var(--ink-700)', fontFamily: 'inherit', fontSize: 13, fontWeight: 600, padding: 0 }}>
                Brain
              </button>
              {breadcrumb.map((f, i) => (
                <span key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <ChevronRight size={11} color="var(--ink-300)"/>
                  <button
                    onClick={() => setCurrentFolderId(f.id)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: i === breadcrumb.length - 1 ? 'var(--ink-700)' : 'var(--maroon-700)', fontFamily: 'inherit', fontSize: 13, fontWeight: i === breadcrumb.length - 1 ? 600 : 500, padding: 0 }}
                  >
                    {f.name}
                  </button>
                </span>
              ))}
            </div>
            <div style={{ position: 'relative', minWidth: 220 }}>
              <Search size={13} color="var(--ink-400)" style={{ position: 'absolute', top: '50%', left: 10, transform: 'translateY(-50%)' }}/>
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search by tag or description"
                style={{ ...inp, paddingLeft: 32, fontSize: 12 }}
              />
            </div>
          </div>

          {/* Grid */}
          {loading ? (
            <div style={{ padding: 60, textAlign: 'center', color: 'var(--ink-400)' }}>Loading…</div>
          ) : visibleItems.length === 0 ? (
            <div style={{ background: 'var(--white)', borderRadius: 'var(--r-lg)', padding: 60, textAlign: 'center', boxShadow: 'var(--shadow-sm)' }}>
              <ImageIcon size={32} color="var(--ink-200)" style={{ margin: '0 auto 12px', display: 'block' }}/>
              <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 18, color: 'var(--ink-700)', marginBottom: 8 }}>
                {search ? 'No matches' : currentFolderId ? 'This folder is empty' : 'Your brain is empty'}
              </h3>
              <p style={{ fontSize: 13, color: 'var(--ink-500)', marginBottom: 18, maxWidth: 380, margin: '0 auto 18px' }}>
                {search
                  ? 'Try different search terms or check spelling.'
                  : 'Upload images and Roam-io will tag them automatically. The more you add, the smarter your generated content becomes.'}
              </p>
              {!search && (
                <button onClick={() => fileInputRef.current?.click()} style={btnP}>
                  <Upload size={13}/> Upload images
                </button>
              )}
            </div>
          ) : (
            <div className="brain-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12 }}>
              {visibleItems.map(item => (
                <div
                  key={item.id}
                  onClick={() => openEdit(item)}
                  className="brain-card"
                  style={{ background: 'var(--white)', borderRadius: 'var(--r-md)', overflow: 'hidden', cursor: 'pointer', boxShadow: 'var(--shadow-sm)', transition: 'transform 0.15s' }}
                  onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; }}
                  onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; }}
                >
                  <div className="brain-card-image" style={{ width: '100%', height: 130, background: 'var(--paper)', position: 'relative' }}>
                    {item.mime?.startsWith('image/')
                      ? <img src={imageUrl(item)} alt={item.description} style={{ width: '100%', height: '100%', objectFit: 'cover' }}/>
                      : item.mime === 'application/pdf'
                        ? <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#fef2f2', color: '#dc2626', gap: 6 }}>
                            <FileText size={32} />
                            <div style={{ fontSize: 9, fontWeight: 600, letterSpacing: '0.08em' }}>PDF</div>
                          </div>
                        : <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg, #f5ecef 0%, #fff4e0 100%)', color: 'var(--maroon-700)', gap: 6 }}>
                            <FileText size={32} />
                            <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                              {item.tags?.includes('ai-generated') ? 'AI Document' : 'Document'}
                            </div>
                          </div>}
                  </div>
                  <div style={{ padding: 10 }}>
                    <div style={{ fontSize: 11, color: 'var(--ink-700)', lineHeight: 1.4, height: 30, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', textOverflow: 'ellipsis' }}>
                      {item.description || <em style={{ color: 'var(--ink-400)' }}>No description</em>}
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, marginTop: 6, minHeight: 18 }}>
                      {item.tags.slice(0, 3).map(t => (
                        <span key={t} style={{ fontSize: 9, background: 'var(--paper)', padding: '1px 6px', borderRadius: 'var(--r-pill)', color: 'var(--ink-500)' }}>
                          {t}
                        </span>
                      ))}
                      {item.tags.length > 3 && <span style={{ fontSize: 9, color: 'var(--ink-400)' }}>+{item.tags.length - 3}</span>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Edit modal — uses .soc-modal-* classes from globals.css so it
          inherits the iOS-safe behaviour (100dvh on mobile + pinned
          header/footer so the Save/Delete buttons don't get hidden under
          the Safari URL bar). */}
      {editing && (
        <div
          className="soc-modal-overlay"
          style={{ zIndex: 500 }}
          onClick={e => { if (e.target === e.currentTarget) setEditing(null); }}
        >
          <div className="soc-modal-panel" style={{ width: 560 }}>
            <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--ink-100)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, color: 'var(--ink-900)' }}>Edit item</div>
              <button onClick={() => setEditing(null)} style={{ ...btnG, padding: '4px 8px' }}><X size={13}/></button>
            </div>
            <div style={{ padding: 20, overflowY: 'auto', flex: 1 }}>
              {editing.mime?.startsWith('image/') ? (
                <img src={imageUrl(editing)} alt="" style={{ width: '100%', maxHeight: 280, objectFit: 'contain', background: 'var(--paper)', borderRadius: 'var(--r-md)', marginBottom: 14 }}/>
              ) : (editing.mime === 'text/markdown' || editing.mime === 'text/plain' || editing.mime?.startsWith('text/')) ? (
                <>
                  <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
                    <button onClick={() => downloadAsMarkdown(editing)} style={{ ...btnG, fontSize: 12 }}>
                      <Download size={12}/> Download .md
                    </button>
                    <a
                      href={`/brain/print/${editing.id}`}
                      target="_blank"
                      rel="noopener"
                      style={{ ...btnG, fontSize: 12, textDecoration: 'none' }}
                      title="Opens a print view — use your browser's Save as PDF"
                    >
                      <Printer size={12}/> Download as PDF
                    </a>
                  </div>
                  <div
                    style={{
                      background: 'var(--paper)', border: '1px solid var(--ink-100)', borderRadius: 'var(--r-md)',
                      padding: '18px 22px', marginBottom: 14, maxHeight: 420, overflowY: 'auto',
                      fontFamily: 'Georgia, serif', fontSize: 13.5, lineHeight: 1.7, color: 'var(--ink-800)',
                      whiteSpace: 'pre-wrap',
                    }}
                  >
                    {previewLoading
                      ? <span style={{ color: 'var(--ink-400)', fontStyle: 'italic' }}>Loading content…</span>
                      : previewContent === null
                        ? <span style={{ color: 'var(--ink-400)', fontStyle: 'italic' }}>Could not load content.</span>
                        : previewContent.trim() === ''
                          ? <span style={{ color: 'var(--ink-400)', fontStyle: 'italic' }}>(empty document)</span>
                          : previewContent}
                  </div>
                </>
              ) : (
                <>
                  <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
                    <a href={imageUrl(editing)} target="_blank" rel="noopener" style={{ ...btnG, fontSize: 12, textDecoration: 'none' }}>
                      <ExternalLink size={12}/> Open original
                    </a>
                    <a href={imageUrl(editing)} download style={{ ...btnG, fontSize: 12, textDecoration: 'none' }}>
                      <Download size={12}/> Download
                    </a>
                  </div>
                  <iframe src={imageUrl(editing)} style={{ width: '100%', height: 420, border: '1px solid var(--ink-100)', borderRadius: 'var(--r-md)', marginBottom: 14, background: 'var(--paper)' }} title="Document preview"/>
                </>
              )}

              <div style={{ marginBottom: 14 }}>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--ink-600)', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Description</label>
                <textarea value={editForm.description} onChange={e => setEditForm({ ...editForm, description: e.target.value })} rows={2} style={{ ...inp, resize: 'vertical' }}/>
              </div>

              <div style={{ marginBottom: 14 }}>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--ink-600)', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Tags <span style={{ fontWeight: 400, color: 'var(--ink-400)', textTransform: 'none' }}>(comma-separated)</span></label>
                <input value={editForm.tags} onChange={e => setEditForm({ ...editForm, tags: e.target.value })} placeholder="darlington, high-street, exterior" style={inp}/>
              </div>

              <div style={{ marginBottom: 14 }}>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--ink-600)', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Folder</label>
                <select value={editForm.folderId} onChange={e => setEditForm({ ...editForm, folderId: e.target.value })} style={{ ...inp, cursor: 'pointer' }}>
                  <option value="">— No folder (Brain root) —</option>
                  {folders.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                </select>
              </div>

              <div style={{ fontSize: 11, color: 'var(--ink-400)' }}>
                Uploaded {new Date(editing.uploadedAt).toLocaleString()} · {(editing.size / 1024).toFixed(0)} KB
              </div>
            </div>
            <div style={{ padding: '12px 20px', borderTop: '1px solid var(--ink-100)', display: 'flex', gap: 8, justifyContent: 'space-between' }}>
              <button onClick={() => handleDeleteItem(editing)} style={{ ...btnG, color: 'var(--alert)' }}><Trash2 size={11}/> Delete</button>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => setEditing(null)} style={btnG}>Cancel</button>
                <button onClick={saveEdit} style={btnP}>Save</button>
              </div>
            </div>
          </div>
        </div>
      )}

      <style jsx>{`
        @keyframes spin { from { transform: rotate(0); } to { transform: rotate(360deg); } }
        :global(.spin) { animation: spin 1s linear infinite; }
      `}</style>
    </div>
  );
}
