'use client';
import {useState,useEffect} from 'react';

interface Contact {id:number;email:string;attributes:Record<string,string>;}
interface QueueItem {id:string;type:'email'|'social';icon:string;title:string;desc:string;town:string;time:string;overdue:boolean;email?:string;businessName?:string;knownFor?:string;step?:number;}
type Status='idle'|'sending'|'done'|'error';

export default function QueuePage(){
  const [contacts,setContacts]=useState<Contact[]>([]);
  const [loading,setLoading]=useState(true);
  const [statuses,setStatuses]=useState<Record<string,Status>>({});
  const [dismissed,setDismissed]=useState<string[]>([]);

  useEffect(()=>{
    fetch('/api/brevo/contacts?limit=500').then(r=>r.json()).then(d=>{setContacts(d.contacts||[]);setLoading(false);}).catch(()=>setLoading(false));
  },[]);

  const emailItems:QueueItem[]=contacts
    .filter(c=>c.email&&c.attributes?.BUSINESS_NAME&&['not_contacted','email_sent','followed_up'].includes(c.attributes?.OUTREACH_STATUS||'not_contacted'))
    .slice(0,10)
    .map(c=>{
      const st=c.attributes?.OUTREACH_STATUS||'not_contacted';
      const step=st==='not_contacted'?1:st==='email_sent'?2:3;
      const label=step===1?'First contact':step===2?'Follow-up':'Final nudge';
      return {id:`email-${c.id}`,type:'email' as const,icon:'✉️',title:`${label} — ${c.attributes.BUSINESS_NAME}`,desc:`Step ${step} of 3 · ${step===1?'Not yet contacted':step===2?'Email sent, no response':'Follow-up sent, no response'}`,town:c.attributes?.TOWN||'—',time:step===3?'overdue':'today',overdue:step===3,email:c.email,businessName:c.attributes.BUSINESS_NAME,knownFor:c.attributes?.KNOWN_FOR||'its independent spirit',step};
    });

  // Social items now come from the real /social calendar, not hard-coded
  // placeholders. The /queue page focuses on outreach approval; social
  // approval has its own UI.
  const allItems=emailItems.filter(i=>!dismissed.includes(i.id));

  async function approve(item:QueueItem){
    setStatuses(s=>({...s,[item.id]:'sending'}));
    try {
      if(item.type==='email'&&item.email){
        const res=await fetch('/api/brevo/send',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:item.email,businessName:item.businessName,town:item.town,knownFor:item.knownFor,step:item.step||1})});
        if(!res.ok)throw new Error('Send failed');
        const newStatus=item.step===1?'email_sent':item.step===2?'followed_up':'cold';
        await fetch('/api/brevo/contacts',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:item.email,OUTREACH_STATUS:newStatus})});
      }
      setStatuses(s=>({...s,[item.id]:'done'}));
      setTimeout(()=>setDismissed(d=>[...d,item.id]),1500);
    } catch {setStatuses(s=>({...s,[item.id]:'error'}));}
  }

  const btnStyle=(st:Status):React.CSSProperties=>({display:'inline-flex',alignItems:'center',gap:5,background:st==='done'?'linear-gradient(135deg,#1a5c36,#2d7a4f)':st==='error'?'#c0392b':'linear-gradient(135deg,#6B1230,#8B1A3A)',color:'#fff',fontSize:11,fontWeight:700,padding:'6px 16px',borderRadius:6,border:'none',cursor:st==='idle'?'pointer':'default',fontFamily:'Nunito Sans,sans-serif'});

  return (
    <div style={{padding:'22px 24px'}}>
      <div style={{marginBottom:20}}>
        <h1 style={{fontFamily:'Nunito,sans-serif',fontSize:22,fontWeight:900,color:'#1a0d12',margin:0}}>Today's Queue</h1>
        <p style={{fontSize:12,color:'#9e7e88',margin:'3px 0 0',fontWeight:500}}>{loading?'Loading…':`${allItems.length} items awaiting approval · nothing sends without your sign-off`}</p>
      </div>
      {loading?(
        <div style={{background:'#fff',border:'1px solid #e4d8dc',borderRadius:12,padding:40,textAlign:'center',color:'#9e7e88',fontSize:13}}>Loading queue from Brevo…</div>
      ):allItems.length===0?(
        <div style={{background:'#fff',border:'1px solid #e4d8dc',borderRadius:12,padding:40,textAlign:'center'}}>
          <div style={{fontSize:32,marginBottom:12}}>✓</div>
          <div style={{fontFamily:'Nunito,sans-serif',fontSize:16,fontWeight:800,color:'#2d7a4f'}}>All done for today!</div>
          <div style={{fontSize:12,color:'#9e7e88',marginTop:6}}>Check back tomorrow for new items</div>
        </div>
      ):(
        <div style={{background:'#fff',border:'1px solid #e4d8dc',borderRadius:12,overflow:'hidden'}}>
          {allItems.map((item,i)=>{
            const status=statuses[item.id]||'idle';
            return (
              <div key={item.id} style={{display:'flex',alignItems:'flex-start',gap:14,padding:'16px 20px',borderBottom:i<allItems.length-1?'1px solid #e4d8dc':'none',opacity:status==='done'?0.4:1,transition:'opacity 0.3s',background:item.overdue?'#fffaf9':'#fff'}}>
                <div style={{width:38,height:38,borderRadius:10,background:item.type==='email'?'#fdf0e4':'#f9eaee',display:'flex',alignItems:'center',justifyContent:'center',fontSize:17,flexShrink:0}}>{item.icon}</div>
                <div style={{flex:1}}>
                  <div style={{fontSize:13,fontWeight:700,marginBottom:3}}>{item.title}</div>
                  <div style={{fontSize:11,color:'#9e7e88',fontWeight:500,marginBottom:4}}>{item.desc}</div>
                  {item.type==='email'&&item.email&&<div style={{fontSize:11,color:'#1a6b9a',fontWeight:600,marginBottom:8}}>→ {item.email} · Step {item.step} of 3</div>}
                  <div style={{display:'flex',gap:8}}>
                    <button onClick={()=>approve(item)} disabled={status!=='idle'} style={btnStyle(status)}>
                      {status==='idle'&&'✓ Approve & Send'}
                      {status==='sending'&&'⟳ Sending…'}
                      {status==='done'&&'✓ Sent!'}
                      {status==='error'&&'✕ Failed'}
                    </button>
                    {status==='idle'&&<>
                      <button style={{fontSize:11,fontWeight:700,color:'#9e7e88',padding:'6px 12px',borderRadius:6,border:'1.5px solid #e4d8dc',background:'transparent',cursor:'pointer',fontFamily:'Nunito Sans,sans-serif'}}>✎ Edit</button>
                      <button onClick={()=>setDismissed(d=>[...d,item.id])} style={{fontSize:11,fontWeight:700,color:'#9e7e88',padding:'6px 12px',borderRadius:6,border:'1.5px solid #e4d8dc',background:'transparent',cursor:'pointer',fontFamily:'Nunito Sans,sans-serif'}}>✕ Skip</button>
                    </>}
                    {status==='error'&&<button onClick={()=>setStatuses(s=>({...s,[item.id]:'idle'}))} style={{fontSize:11,fontWeight:700,color:'#8B1A3A',padding:'6px 12px',borderRadius:6,border:'1.5px solid #e4d8dc',background:'transparent',cursor:'pointer',fontFamily:'Nunito Sans,sans-serif'}}>↻ Retry</button>}
                  </div>
                </div>
                <div style={{flexShrink:0,textAlign:'right'}}>
                  <div style={{fontSize:11,fontWeight:800,color:'#8B1A3A'}}>{item.town}</div>
                  <div style={{fontSize:10,color:item.overdue?'#8B1A3A':'#9e7e88',fontWeight:600,marginTop:2}}>{item.time}</div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
