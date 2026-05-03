'use client';
import {useState,useEffect} from 'react';

interface Stats {total:number;emailSent:number;followUpDue:number;}

export default function SequencesPage(){
  const [stats,setStats]=useState<Stats>({total:0,emailSent:0,followUpDue:0});

  useEffect(()=>{
    fetch('/api/brevo/contacts?limit=500').then(r=>r.json()).then(d=>{
      const contacts=d.contacts||[];
      const emailSent=contacts.filter((c:{attributes?:{OUTREACH_STATUS?:string}})=>
        ['email_sent','followed_up'].includes(c.attributes?.OUTREACH_STATUS||'')
      ).length;
      const followUpDue=contacts.filter((c:{attributes?:{OUTREACH_STATUS?:string}})=>
        c.attributes?.OUTREACH_STATUS==='email_sent'
      ).length;
      setStats({total:contacts.length,emailSent,followUpDue});
    }).catch(()=>{});
  },[]);

  const sequence=[
    {
      step:1,active:true,
      title:'First Contact — Introduction',
      timing:'Sent immediately · Personalised per town',
      subject:'Free listing for [Business] on Roam',
      body:`Hi there,\n\nWe've built a dedicated page for [Town] on Roam — a free local discovery app helping people find the best independent businesses in their area.\n\n[Town] is known for [known_for], and we'd love [Business] to be one of the first businesses featured.\n\nListing takes 90 seconds and is completely free — no subscription, no catch.\n\n[List Business for free →]\n\nAny questions, just reply to this email.\n\nBest wishes,\n— Roam Local Team\nroam-local.co.uk`,
    },
    {
      step:2,active:true,
      title:'Follow-up — Social proof',
      timing:'Day 2 if no response · Short and light',
      subject:'Just checking in — [Town] on Roam',
      body:`Hi there,\n\nJust a quick follow-up — we'd love to have [Business] on Roam's [Town] page.\n\nIt's completely free and takes 90 seconds. Businesses across [Town] are already signing up.\n\n[Get listed now →]\n\nBest wishes,\n— Roam Local Team\nroam-local.co.uk`,
    },
    {
      step:3,active:false,
      title:'Final nudge — Last chance',
      timing:'Day 7 if no response · Last attempt',
      subject:'Last one from us — [Business]',
      body:`Hi there,\n\nWe won't chase again after this — promise!\n\nIf you'd like [Business] featured on Roam's [Town] page for free, it only takes 90 seconds.\n\n[List for free →]\n\nBest wishes,\n— Roam Local Team\nroam-local.co.uk`,
    },
    {
      step:4,active:false,
      title:'Mark as Cold',
      timing:'Day 14 · Archived automatically',
      subject:null,
      body:`Business is marked cold in the pipeline. Can be re-activated after 90 days.`,
    },
  ];

  return (
    <div style={{padding:'22px 24px'}}>
      <div style={{marginBottom:20}}>
        <h1 style={{fontFamily:'Nunito,sans-serif',fontSize:22,fontWeight:900,color:'#1a0d12',margin:0}}>Email Sequences</h1>
        <p style={{fontSize:12,color:'#9e7e88',margin:'3px 0 0',fontWeight:500}}>Automated 3-step outreach · personalised per town using your city page data</p>
      </div>

      <div style={{display:'grid',gridTemplateColumns:'1fr 340px',gap:20,alignItems:'start'}}>
        <div style={{background:'#fff',border:'1px solid #e4d8dc',borderRadius:12,overflow:'hidden'}}>
          <div style={{padding:'15px 20px',borderBottom:'1px solid #e4d8dc',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
            <div style={{fontFamily:'Nunito,sans-serif',fontSize:14,fontWeight:800}}>✉ Outreach Sequence</div>
            <button style={{fontSize:12,fontWeight:700,color:'#8B1A3A',background:'none',border:'none',cursor:'pointer'}}>Edit templates</button>
          </div>
          <div style={{padding:'20px'}}>
            {sequence.map((s,i)=>(
              <div key={s.step} style={{display:'flex',gap:16,marginBottom:i<sequence.length-1?24:0}}>
                <div style={{display:'flex',flexDirection:'column',alignItems:'center',flexShrink:0}}>
                  <div style={{width:32,height:32,borderRadius:'50%',background:s.active?'linear-gradient(135deg,#6B1230,#8B1A3A)':'#e4d8dc',display:'flex',alignItems:'center',justifyContent:'center',fontSize:13,fontWeight:700,color:s.active?'#fff':'#9e7e88'}}>
                    {s.active?'✓':s.step}
                  </div>
                  {i<sequence.length-1&&<div style={{width:2,flex:1,background:'#e4d8dc',margin:'4px 0',minHeight:20}}/>}
                </div>
                <div style={{flex:1,paddingBottom:4}}>
                  <div style={{fontSize:13,fontWeight:700,marginBottom:2}}>{s.title}</div>
                  <div style={{fontSize:11,color:'#9e7e88',fontWeight:500,marginBottom:s.subject?10:0}}>{s.timing}</div>
                  {s.subject&&(
                    <div style={{background:'#f7f3f4',borderRadius:8,padding:'12px 14px',fontSize:12}}>
                      <div style={{fontWeight:700,marginBottom:6,color:'#6b4a55'}}>Subject: {s.subject}</div>
                      <div style={{color:'#1a0d12',lineHeight:1.6,whiteSpace:'pre-line'}}>{s.body}</div>
                    </div>
                  )}
                  {!s.subject&&(
                    <div style={{fontSize:12,color:'#9e7e88',fontStyle:'italic'}}>{s.body}</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div style={{display:'flex',flexDirection:'column',gap:16}}>
          <div style={{background:'#fff',border:'1px solid #e4d8dc',borderRadius:12,overflow:'hidden'}}>
            <div style={{padding:'15px 20px',borderBottom:'1px solid #e4d8dc'}}>
              <div style={{fontFamily:'Nunito,sans-serif',fontSize:14,fontWeight:800}}>∿ Live Stats</div>
            </div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:1,background:'#e4d8dc'}}>
              {[
                {label:'Total Contacts',value:stats.total,color:'#1a6b9a'},
                {label:'Outreach Sent',value:stats.emailSent,color:'#2d7a4f'},
                {label:'Follow-up Due',value:stats.followUpDue,color:'#b06820'},
                {label:'Not Contacted',value:Math.max(0,stats.total-stats.emailSent),color:'#9e7e88'},
              ].map(s=>(
                <div key={s.label} style={{background:'#fff',padding:'14px 16px',textAlign:'center'}}>
                  <div style={{fontFamily:'Nunito,sans-serif',fontSize:26,fontWeight:900,color:s.color}}>{s.value}</div>
                  <div style={{fontSize:10,fontWeight:700,color:'#9e7e88',marginTop:3,textTransform:'uppercase',letterSpacing:0.5}}>{s.label}</div>
                </div>
              ))}
            </div>
          </div>

          <div style={{background:'#fff',border:'1px solid #e4d8dc',borderRadius:12,overflow:'hidden'}}>
            <div style={{padding:'15px 20px',borderBottom:'1px solid #e4d8dc'}}>
              <div style={{fontFamily:'Nunito,sans-serif',fontSize:14,fontWeight:800}}>⚙ Settings</div>
            </div>
            <div style={{padding:'4px 0'}}>
              {[
                {label:'Sending account',value:'hello@roam-everywhere.com'},
                {label:'Send time',value:'Tue–Thu 9–11am'},
                {label:'Follow-up delay',value:'2 days'},
                {label:'Final nudge',value:'Day 7'},
                {label:'Links to',value:'roam-local.co.uk'},
              ].map(s=>(
                <div key={s.label} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'10px 20px',borderBottom:'1px solid #f0e8eb'}}>
                  <span style={{fontSize:12,color:'#6b4a55',fontWeight:500}}>{s.label}</span>
                  <span style={{fontSize:12,fontWeight:700,color:'#1a0d12'}}>{s.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
