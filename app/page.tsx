import { getContacts } from '@/lib/brevo';

type BrevoContact = { attributes?: { OUTREACH_STATUS?: string; TOWN?: string } };

async function getStats() {
  try {
    const data = await getContacts(500, 0);
    const contacts: BrevoContact[] = data.contacts || [];
    const total: number = typeof data.count === 'number' ? data.count : contacts.length;
    let listed = 0, emailSent = 0, followedUp = 0, responded = 0, cold = 0;
    const townSet = new Set<string>();
    for (const c of contacts) {
      const s = c.attributes?.OUTREACH_STATUS || 'not_contacted';
      if (s === 'listed') listed++;
      else if (s === 'email_sent') emailSent++;
      else if (s === 'followed_up') followedUp++;
      else if (s === 'responded') responded++;
      else if (s === 'cold') cold++;
      const t = c.attributes?.TOWN;
      if (t) townSet.add(t);
    }
    const followUpsDue = emailSent + followedUp;
    const emailsSent = emailSent + followedUp + responded + listed + cold;
    const replyRate = emailsSent > 0 ? Math.round(((responded + listed) / emailsSent) * 100) : 0;
    return { total, towns: townSet.size, listed, followUpsDue, emailsSent, replyRate };
  } catch {
    return { total: 0, towns: 0, listed: 0, followUpsDue: 0, emailsSent: 0, replyRate: 0 };
  }
}

export default async function Dashboard() {
  const stats = await getStats();
  const subtitleAction = stats.followUpsDue > 0
    ? `${stats.followUpsDue} follow-up${stats.followUpsDue === 1 ? '' : 's'} due`
    : 'No follow-ups due';
  const cards = [
    {label:'Towns Active',value:stats.towns,delta:stats.towns ? `${stats.towns} active` : 'No towns yet',icon:'📍',color:'#8B1A3A',pale:'#f9eaee'},
    {label:'Businesses Listed',value:stats.listed,delta:stats.listed ? `${stats.listed} live on Roam` : 'None listed yet',icon:'🏪',color:'#2d7a4f',pale:'#e8f5ee'},
    {label:'Follow-ups Due',value:stats.followUpsDue,delta:stats.followUpsDue ? 'Awaiting next step' : 'All caught up',icon:'⏱',color:'#b06820',pale:'#fdf0e4'},
    {label:'Contacts Total',value:stats.total,delta:`${stats.emailsSent} contacted · ${stats.replyRate}% reply`,icon:'✉️',color:'#1a6b9a',pale:'#e4f2fb'},
  ];
  const activity = [
    {dot:'#2d7a4f',text:'The Harbour Arms listed on Roam',time:'Whitstable · 12 min ago'},
    {dot:'#b06820',text:'Email opened — Aberfeldy Bakehouse',time:'Aberfeldy · 41 min ago'},
    {dot:'#2d7a4f',text:'Instagram post live — 87 reach',time:'Frome · 2h ago'},
    {dot:'#8B1A3A',text:'Follow-up overdue — 3 businesses',time:'Aberfeldy · day 4'},
    {dot:'#6a8aaa',text:'Stroud reached flywheel 🌀',time:'Yesterday'},
  ];
  return (
    <div className="page-pad">
      <div className="page-header" style={{marginBottom:24}}>
        <div>
          <h1 style={{fontFamily:'Nunito,sans-serif',fontSize:22,fontWeight:900,color:'#1a0d12',margin:0,letterSpacing:-0.3}}>Growth Dashboard</h1>
          <p style={{fontSize:12,color:'#9e7e88',margin:'3px 0 0',fontWeight:500}}>{new Date().toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'long',year:'numeric'})} · {subtitleAction}</p>
        </div>
        <div className="actions" style={{display:'flex',gap:8}}>
          <a href="/find" style={{display:'inline-flex',alignItems:'center',gap:6,padding:'8px 16px',borderRadius:8,fontSize:12.5,fontWeight:700,background:'transparent',color:'#6b4a55',border:'1.5px solid #e4d8dc',textDecoration:'none'}}>⚡ Find Businesses</a>
          <a href="/contacts" style={{display:'inline-flex',alignItems:'center',gap:6,padding:'8px 16px',borderRadius:8,fontSize:12.5,fontWeight:700,background:'linear-gradient(135deg,#6B1230,#8B1A3A)',color:'#fff',textDecoration:'none',boxShadow:'0 2px 8px rgba(139,26,58,0.28)'}}>➕ Add Business</a>
        </div>
      </div>
      <div className="grid-stats" style={{marginBottom:22}}>
        {cards.map((s,i)=>(
          <div key={i} style={{background:'#fff',border:'1px solid #e4d8dc',borderRadius:12,padding:18,position:'relative',overflow:'hidden'}}>
            <div style={{position:'absolute',top:0,left:0,right:0,height:3,background:`linear-gradient(90deg,${s.color}99,${s.color})`,borderRadius:'12px 12px 0 0'}}/>
            <div style={{width:32,height:32,borderRadius:7,background:s.pale,display:'flex',alignItems:'center',justifyContent:'center',fontSize:15,marginBottom:12}}>{s.icon}</div>
            <div style={{fontSize:10,fontWeight:700,letterSpacing:1,textTransform:'uppercase',color:'#9e7e88',marginBottom:5}}>{s.label}</div>
            <div style={{fontFamily:'Nunito,sans-serif',fontSize:30,fontWeight:900,letterSpacing:-1.5,lineHeight:1,color:'#1a0d12'}}>{s.value}</div>
            <div style={{fontSize:11,fontWeight:700,marginTop:6,color:'#2d7a4f'}}>{s.delta}</div>
          </div>
        ))}
      </div>
      <div className="grid-2col">
        <div style={{background:'#fff',border:'1px solid #e4d8dc',borderRadius:12,overflow:'hidden'}}>
          <div style={{padding:'15px 20px',borderBottom:'1px solid #e4d8dc',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
            <div style={{fontFamily:'Nunito,sans-serif',fontSize:14,fontWeight:800}}>🗺 Town Pipeline</div>
            <a href="/contacts" style={{fontSize:11.5,fontWeight:700,color:'#8B1A3A',textDecoration:'none'}}>View all →</a>
          </div>
          <div className="grid-pipeline" style={{padding:'16px 20px'}}>
            {[{stage:'Not Started',count:971,color:'#9e7e88'},{stage:'Outreach',count:18,color:'#b06820'},{stage:'Biz Live',count:22,color:'#1a6b9a'},{stage:'🌀 Flywheel',count:7,color:'#8B1A3A'}].map(s=>(
              <div key={s.stage} style={{textAlign:'center',padding:'12px 8px',background:'#f7f3f4',borderRadius:8}}>
                <div style={{fontFamily:'Nunito,sans-serif',fontSize:24,fontWeight:900,color:s.color}}>{s.count}</div>
                <div style={{fontSize:9.5,fontWeight:700,color:'#9e7e88',marginTop:4}}>{s.stage}</div>
              </div>
            ))}
          </div>
        </div>
        <div style={{background:'#fff',border:'1px solid #e4d8dc',borderRadius:12,overflow:'hidden'}}>
          <div style={{padding:'15px 20px',borderBottom:'1px solid #e4d8dc'}}>
            <div style={{fontFamily:'Nunito,sans-serif',fontSize:14,fontWeight:800}}>∿ Recent Activity</div>
          </div>
          {activity.map((a,i)=>(
            <div key={i} style={{display:'flex',gap:11,padding:'11px 20px',borderBottom:i<activity.length-1?'1px solid #e4d8dc':'none'}}>
              <div style={{paddingTop:5}}><div style={{width:8,height:8,borderRadius:'50%',background:a.dot}}/></div>
              <div>
                <div style={{fontSize:12,color:'#6b4a55',fontWeight:500}}>{a.text}</div>
                <div style={{fontSize:10,color:'#9e7e88',marginTop:2,fontWeight:600}}>{a.time}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
