'use client';
import {useState,useEffect} from 'react';
import {Mail,Settings,TrendingUp,CheckCircle,Clock,Users,AlertCircle} from 'lucide-react';

interface Stats {total:number;emailSent:number;followUpDue:number;}

const sequence=[
  {step:1,active:true,title:'First Contact — Introduction',timing:'Sent immediately · Personalised per town',subject:'Free listing for [Business] on Roam',body:'Hi there,\n\nWe\u2019ve built a dedicated page for [Town] on Roam \u2014 a free local discovery app helping people find the best independent businesses in their area.\n\n[Town] is known for [known_for], and we\u2019d love [Business] to be one of the first businesses featured.\n\nListing takes 90 seconds and is completely free \u2014 no subscription, no catch.\n\n[List Business for free \u2192]\n\nAny questions, just reply to this email.\n\nBest wishes,\n\u2014 Roam Local Team\nroam-local.co.uk'},
  {step:2,active:true,title:'Follow-up — Social proof',timing:'Day 2 if no response · Short and light',subject:'Just checking in \u2014 [Town] on Roam',body:'Hi there,\n\nJust a quick follow-up \u2014 we\u2019d love to have [Business] on Roam\u2019s [Town] page.\n\nIt\u2019s completely free and takes 90 seconds. Businesses across [Town] are already signing up.\n\n[Get listed now \u2192]\n\nBest wishes,\n\u2014 Roam Local Team\nroam-local.co.uk'},
  {step:3,active:false,title:'Final Nudge — Last chance',timing:'Day 7 if no response · Last attempt',subject:'Last one from us \u2014 [Business]',body:'Hi there,\n\nWe won\u2019t chase again after this \u2014 promise!\n\nIf you\u2019d like [Business] featured on Roam\u2019s [Town] page for free, it only takes 90 seconds.\n\n[List for free \u2192]\n\nBest wishes,\n\u2014 Roam Local Team\nroam-local.co.uk'},
  {step:4,active:false,title:'Mark as Cold',timing:'Day 14 · Archived automatically',subject:null,body:'Business is marked cold in the pipeline. Can be re-activated after 90 days.'},
];

export default function SequencesPage(){
  const [stats,setStats]=useState<Stats>({total:0,emailSent:0,followUpDue:0});
  const [running,setRunning]=useState(false);
  const [lastRun,setLastRun]=useState<string|null>(null);
  const [runResult,setRunResult]=useState<string|null>(null);

  async function runSequences(){
    setRunning(true);setRunResult(null);
    try{
      const res=await fetch('/api/sequences?secret=roam-cron-2026');
      const data=await res.json();
      setLastRun(new Date().toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'}));
      setRunResult(data.message||'Complete');
    }catch(e){setRunResult('Error running sequences');}
    setRunning(false);
  }
  const [expanded,setExpanded]=useState<number|null>(1);

  useEffect(()=>{
    fetch('/api/brevo/contacts?limit=500').then(r=>r.json()).then(d=>{
      const contacts=d.contacts||[];
      const emailSent=contacts.filter((c:{attributes?:{OUTREACH_STATUS?:string}})=>['email_sent','followed_up'].includes(c.attributes?.OUTREACH_STATUS||'')).length;
      const followUpDue=contacts.filter((c:{attributes?:{OUTREACH_STATUS?:string}})=>c.attributes?.OUTREACH_STATUS==='email_sent').length;
      setStats({total:contacts.length,emailSent,followUpDue});
    }).catch(()=>{});
  },[]);

  return (
    <div className="page-wrap">
      <div className="page-header">
        <div>
          <h1 className="page-title">Email Sequences</h1>
          <p className="page-sub">Automated 3-step outreach · personalised per town using your city page data</p>
        </div>
        <div className="btn-row">
          <button className="btn-ghost" style={{fontSize:12}}>Edit templates</button>
          <button onClick={runSequences} disabled={running} className="btn-primary" style={{fontSize:12,opacity:running?0.6:1}}>
            {running?'Running…':'▶ Run sequences now'}
          </button>
        </div>
      </div>

      <div className="stat-grid" style={{marginBottom:20}}>
        {[
          {label:'Total Contacts',value:stats.total,color:'var(--info)'},
          {label:'Outreach Sent',value:stats.emailSent,color:'var(--ok)'},
          {label:'Follow-up Due',value:stats.followUpDue,color:'var(--warn)'},
          {label:'Not Contacted',value:Math.max(0,stats.total-stats.emailSent),color:'var(--ink-400)'},
        ].map(s=>(
          <div key={s.label} className="stat-card">
            <div className="stat-label">{s.label}</div>
            <div className="stat-num" style={{fontSize:28,color:s.color}}>{s.value}</div>
          </div>
        ))}
      </div>

      <div className="two-col" style={{alignItems:'start'}}>
        <div className="card">
          <div className="card-header">
            <div style={{display:'flex',alignItems:'center',gap:8}}>
              <Mail size={15} color="var(--maroon-600)"/>
              <span>Outreach Sequence</span>
            </div>
          </div>
          <div style={{padding:'16px 20px'}}>
            {sequence.map((s,i)=>(
              <div key={s.step} style={{display:'flex',gap:14,marginBottom:i<sequence.length-1?20:0}}>
                <div style={{display:'flex',flexDirection:'column',alignItems:'center',flexShrink:0}}>
                  <div style={{width:30,height:30,borderRadius:'50%',background:s.active?'var(--maroon-700)':'var(--ink-100)',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
                    {s.active?<CheckCircle size={15} color="white"/>:<span style={{fontSize:12,fontWeight:700,color:'var(--ink-400)'}}>{s.step}</span>}
                  </div>
                  {i<sequence.length-1&&<div style={{width:2,flex:1,background:'var(--ink-100)',margin:'4px 0',minHeight:16}}/>}
                </div>
                <div style={{flex:1,minWidth:0,paddingBottom:4}}>
                  <button onClick={()=>setExpanded(expanded===s.step?null:s.step)} style={{width:'100%',textAlign:'left',background:'none',border:'none',cursor:'pointer',padding:0,marginBottom:4}}>
                    <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:8}}>
                      <div style={{fontSize:13,fontWeight:700,color:'var(--ink-900)'}}>{s.title}</div>
                      <div style={{fontSize:16,color:'var(--ink-300)',flexShrink:0}}>{expanded===s.step?'−':'+'}</div>
                    </div>
                  </button>
                  <div style={{fontSize:11,color:'var(--ink-400)',fontWeight:500,marginBottom:expanded===s.step?10:0}}>{s.timing}</div>
                  {expanded===s.step&&s.subject&&(
                    <div style={{background:'var(--paper)',border:'1px solid var(--ink-100)',borderRadius:'var(--r-md)',padding:'12px 14px',fontSize:12}}>
                      <div style={{fontSize:10,fontWeight:700,color:'var(--ink-400)',letterSpacing:'0.08em',textTransform:'uppercase',marginBottom:4}}>Subject</div>
                      <div style={{fontWeight:600,color:'var(--ink-800)',marginBottom:10,fontSize:13}}>{s.subject}</div>
                      <div style={{color:'var(--ink-700)',lineHeight:1.7,whiteSpace:'pre-line',borderTop:'1px solid var(--ink-100)',paddingTop:10}}>{s.body}</div>
                    </div>
                  )}
                  {expanded===s.step&&!s.subject&&(
                    <div style={{fontSize:12,color:'var(--ink-400)',fontStyle:'italic'}}>{s.body}</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div style={{display:'flex',flexDirection:'column',gap:16}}>
          <div className="card">
            <div className="card-header">
              <div style={{display:'flex',alignItems:'center',gap:8}}>
                <TrendingUp size={15} color="var(--ok)"/>
                <span>Performance</span>
              </div>
            </div>
            <div style={{padding:'4px 0'}}>
              {[{label:'Open rate',value:'—',sub:'No sends yet'},{label:'Reply rate',value:'—',sub:'No sends yet'},{label:'Listed rate',value:'—',sub:'No conversions yet'}].map(r=>(
                <div key={r.label} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'12px 20px',borderBottom:'1px solid var(--ink-100)'}}>
                  <div>
                    <div style={{fontSize:13,fontWeight:600,color:'var(--ink-800)'}}>{r.label}</div>
                    <div style={{fontSize:11,color:'var(--ink-400)'}}>{r.sub}</div>
                  </div>
                  <div style={{fontSize:22,fontFamily:'var(--font-display)',color:'var(--ink-300)'}}>{r.value}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="card">
            <div className="card-header">
              <div style={{display:'flex',alignItems:'center',gap:8}}>
                <Settings size={15} color="var(--ink-400)"/>
                <span>Settings</span>
              </div>
            </div>
            <div style={{padding:'4px 0'}}>
              {[
                {label:'Sending account',value:'hello@roam-everywhere.com'},
                {label:'Send time',value:'Tue–Thu 9–11am'},
                {label:'Follow-up delay',value:'2 days'},
                {label:'Final nudge',value:'Day 7'},
                {label:'Links to',value:'roam-local.co.uk'},
              ].map(s=>(
                <div key={s.label} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'10px 20px',borderBottom:'1px solid var(--ink-100)',flexWrap:'wrap',gap:4}}>
                  <span style={{fontSize:12,color:'var(--ink-500)',fontWeight:500}}>{s.label}</span>
                  <span style={{fontSize:12,fontWeight:700,color:'var(--ink-900)'}}>{s.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
