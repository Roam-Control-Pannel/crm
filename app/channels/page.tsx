export default function ChannelsPage() {
  const channels = [
    {name:'Brevo Email',handle:'hello@roam-everywhere.com',icon:'✉️',status:'live',health:97,color:'#2f7a4f',desc:'Transactional outreach emails — 3-step sequence to roam-local.co.uk',stats:[{label:'Sender',value:'hello@roam-everywhere.com'},{label:'Domain',value:'roam-everywhere.com ✓'},{label:'Links to',value:'roam-local.co.uk'},{label:'Sequence',value:'Day 1 · Day 2 · Day 7'}]},
    {name:'Instagram',handle:'@roamlocal',icon:'📸',status:'not_connected',health:0,color:'#c96442',desc:'Post town discovery content and business spotlights',stats:[]},
    {name:'LinkedIn',handle:'Roam Local',icon:'💼',status:'not_connected',health:0,color:'#2a5fa4',desc:'Reach local business owners and decision makers',stats:[]},
    {name:'X / Twitter',handle:'Not connected',icon:'𝕏',status:'not_connected',health:0,color:'#1a1213',desc:'Town announcements and discovery content',stats:[]},
  ];
  return (
    <div style={{padding:'24px 28px'}}>
      <div style={{marginBottom:24}}>
        <h1 style={{fontFamily:'Instrument Serif, serif',fontSize:28,fontWeight:400,color:'var(--ink-900)',lineHeight:1}}>Channels</h1>
        <p style={{fontSize:12,color:'var(--ink-400)',marginTop:5,fontWeight:500}}>Manage your connected publishing and outreach channels</p>
      </div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(2,1fr)',gap:16}}>
        {channels.map(ch=>(
          <div key={ch.name} style={{background:'var(--white)',borderRadius:'var(--r-lg)',boxShadow:'var(--shadow-sm)',overflow:'hidden'}}>
            <div style={{padding:'18px 20px',borderBottom:'1px solid var(--ink-100)'}}>
              <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',gap:12,marginBottom:10}}>
                <div style={{display:'flex',alignItems:'center',gap:12}}>
                  <div style={{width:44,height:44,borderRadius:'var(--r-md)',background:ch.status==='live'?'var(--maroon-50)':'var(--ink-100)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:22,flexShrink:0}}>{ch.icon}</div>
                  <div>
                    <div style={{fontSize:15,fontWeight:700,color:'var(--ink-900)'}}>{ch.name}</div>
                    <div style={{fontSize:11.5,color:'var(--ink-400)',marginTop:2}}>{ch.handle}</div>
                  </div>
                </div>
                {ch.status==='live'
                  ?<span style={{display:'inline-flex',alignItems:'center',gap:5,padding:'3px 10px',borderRadius:'999px',background:'#e8f5ee',color:'#2f7a4f',fontSize:11,fontWeight:600,flexShrink:0}}><span style={{width:6,height:6,borderRadius:'50%',background:'#2f7a4f',display:'inline-block'}}/>Live</span>
                  :<span style={{display:'inline-flex',alignItems:'center',gap:5,padding:'3px 10px',borderRadius:'999px',background:'var(--ink-100)',color:'var(--ink-400)',fontSize:11,fontWeight:600,flexShrink:0}}><span style={{width:6,height:6,borderRadius:'50%',background:'var(--ink-300)',display:'inline-block'}}/>Not connected</span>
                }
              </div>
              <div style={{fontSize:12,color:'var(--ink-500)',lineHeight:1.5}}>{ch.desc}</div>
            </div>
            {ch.stats.length>0&&(
              <div style={{padding:'14px 20px',borderBottom:'1px solid var(--ink-100)',display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
                {ch.stats.map((s:{label:string;value:string})=>(
                  <div key={s.label}>
                    <div style={{fontSize:9.5,letterSpacing:'0.08em',textTransform:'uppercase',color:'var(--ink-400)',fontWeight:600,marginBottom:2}}>{s.label}</div>
                    <div style={{fontSize:12,fontWeight:600,color:'var(--ink-800)'}}>{s.value}</div>
                  </div>
                ))}
              </div>
            )}
            {ch.health>0&&(
              <div style={{padding:'12px 20px',borderBottom:'1px solid var(--ink-100)'}}>
                <div style={{display:'flex',justifyContent:'space-between',fontSize:11,color:'var(--ink-400)',marginBottom:6}}>
                  <span>Channel health</span>
                  <span style={{fontWeight:700,color:ch.color}}>{ch.health}%</span>
                </div>
                <div style={{background:'var(--ink-100)',borderRadius:'999px',height:5,overflow:'hidden'}}>
                  <div style={{height:'100%',width:`${ch.health}%`,borderRadius:'999px',background:ch.color}}/>
                </div>
              </div>
            )}
            <div style={{padding:'12px 20px',display:'flex',gap:8}}>
              {ch.status==='live'
                ?<><button style={{padding:'7px 14px',borderRadius:'var(--r-sm)',background:'var(--maroon-700)',color:'white',fontSize:11.5,fontWeight:600,border:'none',cursor:'pointer'}}>⚙ Configure</button>
                  <button style={{padding:'7px 14px',borderRadius:'var(--r-sm)',background:'transparent',color:'var(--ink-500)',fontSize:11.5,fontWeight:600,border:'1.5px solid var(--ink-200)',cursor:'pointer'}}>View logs</button></>
                :<button style={{padding:'7px 14px',borderRadius:'var(--r-sm)',background:'var(--maroon-700)',color:'white',fontSize:11.5,fontWeight:600,border:'none',cursor:'pointer'}}>+ Connect {ch.name}</button>
              }
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
