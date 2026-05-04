'use client';
import {useState,useEffect,useRef} from 'react';
import ReactDOM from 'react-dom';
import { Bell, X, Mail, XCircle, Plus, List, Check, AlertTriangle, Sparkles, Info } from 'lucide-react';

export interface Notification {
  id: string;
  type: 'email_sent'|'email_failed'|'contact_imported'|'list_created'|'listed'|'overdue'|'enriched'|'info';
  title: string;
  body: string;
  time: Date;
  read: boolean;
}

const listeners = new Set<(n: Notification[]) => void>();
let notifications: Notification[] = [];

export function addNotification(n: Omit<Notification,'id'|'time'|'read'>) {
  const notif: Notification = { ...n, id: Math.random().toString(36).slice(2), time: new Date(), read: false };
  notifications = [notif, ...notifications].slice(0, 50);
  listeners.forEach(l => l([...notifications]));
}

export function useNotifications() {
  const [state, setState] = useState<Notification[]>([...notifications]);
  useEffect(() => { listeners.add(setState); return () => { listeners.delete(setState); }; }, []);
  return state;
}

const typeColor: Record<string,string> = {
  email_sent: '#2f7a4f', email_failed: '#b53939', contact_imported: '#2a5fa4',
  list_created: '#9b2752', listed: '#2f7a4f', overdue: '#c47a1a', enriched: '#2f7a4f', info: '#7d6e70',
};

function TypeIcon({type}: {type: string}) {
  const color = typeColor[type] || '#7d6e70';
  const size = 14;
  if (type==='email_sent') return <Mail size={size} color={color}/>;
  if (type==='email_failed') return <XCircle size={size} color={color}/>;
  if (type==='contact_imported') return <Plus size={size} color={color}/>;
  if (type==='list_created') return <List size={size} color={color}/>;
  if (type==='listed') return <Check size={size} color={color}/>;
  if (type==='overdue') return <AlertTriangle size={size} color={color}/>;
  if (type==='enriched') return <Sparkles size={size} color={color}/>;
  return <Info size={size} color={color}/>;
}

function timeAgo(d: Date): string {
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s/60) + 'm ago';
  if (s < 86400) return Math.floor(s/3600) + 'h ago';
  return Math.floor(s/86400) + 'd ago';
}

export default function NotificationCentre() {
  const notifs = useNotifications();
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const unread = notifs.filter(n => !n.read).length;

  useEffect(() => { setMounted(true); }, []);

  function markAllRead() {
    notifications = notifications.map(n => ({...n, read: true}));
    listeners.forEach(l => l([...notifications]));
  }

  function clearAll() { notifications = []; listeners.forEach(l => l([])); }

  const panel = mounted && open ? ReactDOM.createPortal(
    <>
      <div
        onClick={() => setOpen(false)}
        style={{position:'fixed',inset:0,background:'rgba(26,13,18,0.6)',zIndex:99998}}
      />
      <div style={{
        position:'fixed', top:0, right:0, bottom:0,
        width:'min(340px, 100vw)',
        background:'var(--white)',
        boxShadow:'-4px 0 24px rgba(26,18,19,0.2)',
        zIndex:99999,
        display:'flex', flexDirection:'column',
        animation:'slideInRight 0.25s cubic-bezier(0.4,0,0.2,1)',
      }}>
        <div style={{padding:'18px 20px',borderBottom:'1px solid var(--ink-100)',display:'flex',alignItems:'center',justifyContent:'space-between',flexShrink:0}}>
          <div>
            <div style={{fontFamily:'var(--font-display)',fontSize:18,color:'var(--ink-900)'}}>Notifications</div>
            <div style={{fontSize:11,color:'var(--ink-400)',marginTop:2}}>{notifs.length} total · {unread} unread</div>
          </div>
          <div style={{display:'flex',gap:8,alignItems:'center'}}>
            {notifs.length > 0 && <button onClick={clearAll} style={{fontSize:11,fontWeight:600,color:'var(--ink-400)',background:'none',border:'none',cursor:'pointer'}}>Clear all</button>}
            <button onClick={() => setOpen(false)} style={{width:28,height:28,borderRadius:'var(--r-xs)',border:'1.5px solid var(--ink-200)',background:'var(--white)',cursor:'pointer',color:'var(--ink-500)',display:'flex',alignItems:'center',justifyContent:'center'}}>
              <X size={14}/>
            </button>
          </div>
        </div>
        <div style={{flex:1,overflowY:'auto'}}>
          {notifs.length === 0 ? (
            <div style={{padding:48,textAlign:'center'}}>
              <div style={{display:'flex',justifyContent:'center',marginBottom:12,opacity:0.25}}><Bell size={40} color="var(--ink-400)"/></div>
              <div style={{fontFamily:'var(--font-display)',fontSize:18,color:'var(--ink-700)',marginBottom:8}}>All caught up</div>
              <div style={{fontSize:12,color:'var(--ink-400)',lineHeight:1.6}}>Notifications will appear here as you work — emails sent, contacts imported, lists created and more.</div>
            </div>
          ) : notifs.map(n => (
            <div key={n.id} style={{display:'flex',gap:12,padding:'14px 20px',borderBottom:'1px solid var(--ink-100)',background:n.read?'var(--white)':'#fbeaef'}}>
              <div style={{width:32,height:32,borderRadius:'var(--r-sm)',background:n.read?'var(--ink-100)':'#f4d8df',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
                <TypeIcon type={n.type}/>
              </div>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:13,fontWeight:600,color:'var(--ink-900)',marginBottom:2}}>{n.title}</div>
                <div style={{fontSize:11.5,color:'var(--ink-500)',lineHeight:1.4}}>{n.body}</div>
                <div style={{fontSize:10.5,color:'var(--ink-300)',marginTop:4,fontWeight:500}}>{timeAgo(n.time)}</div>
              </div>
              {!n.read && <div style={{width:7,height:7,borderRadius:'50%',background:'#d03050',flexShrink:0,marginTop:4}}/>}
            </div>
          ))}
        </div>
      </div>
    </>,
    document.body
  ) : null;

  return (
    <>
      <button
        onClick={() => { setOpen(o => !o); if (!open) markAllRead(); }}
        style={{
          width:32,height:32,borderRadius:'var(--r-sm)',
          background:open?'rgba(255,255,255,0.15)':'rgba(255,255,255,0.08)',
          border:'none',cursor:'pointer',
          display:'flex',alignItems:'center',justifyContent:'center',
          color:'rgba(255,255,255,0.7)',position:'relative',transition:'all 0.15s',
          flexShrink:0,
        }}
      >
        <Bell size={15}/>
        {unread > 0 && (
          <span style={{position:'absolute',top:-4,right:-4,background:'#d03050',color:'white',fontSize:9,fontWeight:700,width:16,height:16,borderRadius:'50%',display:'flex',alignItems:'center',justifyContent:'center'}}>
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>
      {panel}
    </>
  );
}
