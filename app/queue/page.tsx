'use client';
import { useEffect, useState } from 'react';

interface Contact {
  id: number;
  email: string;
  attributes?: {
    BUSINESS_NAME?: string;
    FIRSTNAME?: string;
    TOWN?: string;
    OUTREACH_STATUS?: string;
    NOTES?: string;
    BUSINESS_TYPE?: string;
  };
  modifiedAt?: string;
}

interface QueueItem {
  id: number;
  email: string;
  icon: string;
  title: string;
  desc: string;
  town: string;
  stage: string;
  overdue: boolean;
}

const FOLLOW_UP_STATUSES = new Set(['email_sent', 'followed_up']);

function buildItem(c: Contact): QueueItem {
  const status = c.attributes?.OUTREACH_STATUS || 'not_contacted';
  const name = c.attributes?.BUSINESS_NAME || c.attributes?.FIRSTNAME || c.email || 'Unknown';
  const town = c.attributes?.TOWN || '—';
  const type = c.attributes?.BUSINESS_TYPE || 'Local business';
  const isFollowUp = status === 'followed_up';
  const stage = isFollowUp ? 'Day 7 — final nudge' : 'Day 2 — follow-up';
  return {
    id: c.id,
    email: c.email,
    icon: '✉️',
    title: `${isFollowUp ? 'Final nudge' : 'Follow-up email'} · ${name}`,
    desc: `${type} · ${isFollowUp ? 'Sequence step 3 of 3' : 'Sequence step 2 of 3'} — last contact pending response`,
    town,
    stage,
    overdue: isFollowUp,
  };
}

export default function QueuePage() {
  const [items, setItems] = useState<QueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [actioning, setActioning] = useState<number | null>(null);

  useEffect(() => {
    fetch('/api/brevo/contacts?limit=500')
      .then(r => r.json())
      .then(d => {
        const contacts: Contact[] = d.contacts || [];
        const queue = contacts
          .filter(c => FOLLOW_UP_STATUSES.has(c.attributes?.OUTREACH_STATUS || ''))
          .map(buildItem);
        setItems(queue);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  async function skip(item: QueueItem) {
    setActioning(item.id);
    try {
      await fetch('/api/brevo/contacts', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: item.email, OUTREACH_STATUS: 'cold' }),
      });
      setItems(prev => prev.filter(i => i.id !== item.id));
    } catch (e) {
      console.error(e);
    }
    setActioning(null);
  }

  return (
    <div className="page-pad">
      <div style={{marginBottom:20}}>
        <h1 style={{fontFamily:'Nunito,sans-serif',fontSize:22,fontWeight:900,color:'#1a0d12',margin:0}}>Today&apos;s Queue</h1>
        <p style={{fontSize:12,color:'#9e7e88',margin:'3px 0 0',fontWeight:500}}>
          {loading
            ? 'Loading follow-ups…'
            : items.length === 0
            ? 'All caught up — no follow-ups due'
            : `${items.length} follow-up${items.length === 1 ? '' : 's'} due · nothing sends without your sign-off`}
        </p>
      </div>
      <div style={{background:'#fff',border:'1px solid #e4d8dc',borderRadius:12,overflow:'hidden'}}>
        {loading ? (
          <div style={{padding:40,textAlign:'center',color:'#9e7e88',fontSize:13}}>Loading from Brevo…</div>
        ) : items.length === 0 ? (
          <div style={{padding:40,textAlign:'center',color:'#9e7e88',fontSize:13}}>
            <div style={{fontSize:30,marginBottom:10}}>🎉</div>
            <div style={{fontWeight:700,color:'#1a0d12',marginBottom:4}}>Nothing pending</div>
            <div>Outreach is up to date. New follow-ups appear here automatically.</div>
          </div>
        ) : items.map((item,i) => (
          <div key={item.id} className="queue-row" style={{display:'flex',alignItems:'flex-start',gap:14,padding:'16px 20px',borderBottom:i<items.length-1?'1px solid #e4d8dc':'none'}}>
            <div style={{width:38,height:38,borderRadius:10,background:item.overdue?'#fdf0e4':'#f9eaee',display:'flex',alignItems:'center',justifyContent:'center',fontSize:17,flexShrink:0}}>{item.icon}</div>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontSize:13,fontWeight:700,marginBottom:3}}>{item.title}</div>
              <div style={{fontSize:11,color:'#9e7e88',fontWeight:500}}>{item.desc}</div>
              <div style={{display:'flex',gap:8,marginTop:10,flexWrap:'wrap'}}>
                <button onClick={()=>alert('Approval flow not built yet')} style={{display:'inline-flex',alignItems:'center',gap:5,background:'linear-gradient(135deg,#6B1230,#8B1A3A)',color:'#fff',fontSize:11,fontWeight:700,padding:'6px 14px',borderRadius:6,border:'none',cursor:'pointer',fontFamily:'Nunito Sans,sans-serif'}}>✓ Approve</button>
                <button onClick={()=>skip(item)} disabled={actioning===item.id} style={{display:'inline-flex',alignItems:'center',gap:5,background:'transparent',color:'#9e7e88',fontSize:11,fontWeight:700,padding:'6px 12px',borderRadius:6,border:'1.5px solid #e4d8dc',cursor:'pointer',fontFamily:'Nunito Sans,sans-serif',opacity:actioning===item.id?0.5:1}}>{actioning===item.id?'…':'✕ Skip'}</button>
              </div>
            </div>
            <div className="queue-meta" style={{flexShrink:0,textAlign:'right'}}>
              <div style={{fontSize:11,fontWeight:800,color:'#8B1A3A'}}>{item.town}</div>
              <div style={{fontSize:10,color:item.overdue?'#8B1A3A':'#9e7e88',fontWeight:600,marginTop:2}}>{item.stage}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
