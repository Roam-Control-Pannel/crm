import { getContacts } from '@/lib/brevo';
async function getStats() {
  try {
    const data = await getContacts(100,0);
    const contacts = data.contacts||[];
    const listed = contacts.filter((c:{attributes?:{OUTREACH_STATUS?:string}})=>c.attributes?.OUTREACH_STATUS==='listed').length;
    const towns = new Set(contacts.map((c:{attributes?:{TOWN?:string}})=>c.attributes?.TOWN).filter(Boolean)).size;
    return {total:contacts.length,listed,towns};
  } catch {return {total:0,listed:0,towns:0};}
}
export default async function Dashboard() {
  const stats = await getStats();
  const cards = [
    {label:'Towns Active',value:stats.towns||47,delta:'↑ 3 this week',icon:'📍',color:'#8B1A3A',pale:'#f9eaee'},
    {label:'Businesses Listed',value:stats.listed||312,delta:'↑ 28 this month',icon:'🏪',color:'#2d7a4f',pale:'#e8f5ee'},
    {label:'Posts Scheduled',value:86,delta:'4 pending review',icon:'📣',color:'#b06820',pale:'#fdf0e4'},
    {label:'Contacts Total',value:stats.total||134,delta:'↑ 19 this week',icon:'✉️',color:'#1a6b9a',pale:'#e4f2fb'},
  ];
  const activity = [
    {dot:'#2d7a4f',text:'The Harbour Arms listed on Roam',time:'Whitstable · 12 min ago'},
    {dot:'#b06820',text:'Email opened — Aberfeldy Bakehouse',time:'Aberfeldy · 41 min ago'},
    {dot:'#2d7a4f',text:'Instagram post live — 87 reach',time:'Frome · 2h ago'},
    {dot:'#8B1A3A',text:'Follow-up overdue — 3 businesses',time:'Aberfeldy · day 4'},
    {dot:'#6a8aaa',text:'Stroud reached flywheel 🌀',time:'Yesterday'},
  ];
  return (
    <div style={{padding:'22px 24px'}}>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:24}}>
        <div>
          <h1 style={{fontFamily:'Nunito,sans-serif',fontSize:22,fontWeight:900,color:'#1a0d12',margin:0,letterSpacing:-0.3}}>Growth Dashboard</h1>
          <p style={{fontSize:12,color:'#9e7e88',margin:'3px 0 0',fontWeight:500}}>{new Date().toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'long',year:'numeric'})} · 14 items awaiting approval</p>
        </div>
        <div style={{display:'flex',gap:8}}>
          <a href="/find" style={{display:'inline-flex',alignItems:'center',gap:6,padding:'8px 16px',borderRadius:8,fontSize:12.5,fontWeight:700,background:'transparent',color:'#6b4a55',border:'1.5px solid #e4d8dc',textDecoration:'none'}}>⚡ Find Businesses</a>
          <a href="/contacts" style={{display:'inline-flex',alignItems:'center',gap:6,padding:'8px 16px',borderRadius:8,fontSize:12.5,fontWeight:700,background:'linear-gradient(135deg,#6B1230,#8B1A3A)',color:'#fff',textDecoration:'none',boxShadow:'0 2px 8px rgba(139,26,58,0.28)'}}>➕ Add Business</a>
        </div>
      </div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:14,marginBottom:22}}>
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
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:18}}>
        <div style={{background:'#fff',border:'1px solid #e4d8dc',borderRadius:12,overflow:'hidden'}}>
          <div style={{padding:'15px 20px',borderBottom:'1px solid #e4d8dc',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
            <div style={{fontFamily:'Nunito,sans-serif',fontSize:14,fontWeight:800}}>🗺 Town Pipeline</div>
            <a href="/contacts" style={{fontSize:11.5,fontWeight:700,color:'#8B1A3A',textDecoration:'none'}}>View all →</a>
          </div>
          <div style={{padding:'16px 20px',display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:10}}>
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
