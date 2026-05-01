export default function ChannelsPage() {
  const channels = [
    {icon:'📸',name:'Instagram',handle:'@roamlocal',status:'live',pct:82,color:'#8B1A3A'},
    {icon:'💼',name:'LinkedIn',handle:'Roam Local',status:'live',pct:67,color:'#1a6b9a'},
    {icon:'✉️',name:'Brevo Email',handle:'hello@roamlocal.app',status:'live',pct:91,color:'#2d7a4f'},
    {icon:'𝕏',name:'X / Twitter',handle:'Not connected',status:'setup',pct:40,color:'#b06820'},
    {icon:'📘',name:'Facebook API',handle:'Developer app pending',status:'pending',pct:20,color:'#8B1A3A'},
  ];
  const ss:{[k:string]:{bg:string;color:string;label:string}} = {
    live:{bg:'#e8f5ee',color:'#2d7a4f',label:'Live'},
    setup:{bg:'#fdf0e4',color:'#b06820',label:'Setup'},
    pending:{bg:'#f9eaee',color:'#8B1A3A',label:'Pending'},
  };
  return (
    <div style={{padding:'22px 24px'}}>
      <div style={{marginBottom:20}}>
        <h1 style={{fontFamily:'Nunito,sans-serif',fontSize:22,fontWeight:900,color:'#1a0d12',margin:0}}>Channels</h1>
        <p style={{fontSize:12,color:'#9e7e88',margin:'3px 0 0',fontWeight:500}}>Manage your connected publishing and outreach channels</p>
      </div>
      <div style={{background:'#fff',border:'1px solid #e4d8dc',borderRadius:12,overflow:'hidden'}}>
        <div style={{padding:'15px 20px',borderBottom:'1px solid #e4d8dc'}}>
          <div style={{fontFamily:'Nunito,sans-serif',fontSize:14,fontWeight:800}}>⚙ Channel Configuration</div>
        </div>
        <div style={{padding:'8px 0'}}>
          {channels.map((ch,i)=>{
            const s=ss[ch.status];
            return (
              <div key={i} style={{display:'flex',alignItems:'center',gap:14,padding:'16px 20px',borderBottom:i<channels.length-1?'1px solid #e4d8dc':'none'}}>
                <div style={{width:42,height:42,borderRadius:10,background:'#f7f3f4',display:'flex',alignItems:'center',justifyContent:'center',fontSize:20,flexShrink:0}}>{ch.icon}</div>
                <div style={{flex:1}}>
                  <div style={{fontSize:13,fontWeight:700}}>{ch.name}</div>
                  <div style={{fontSize:11,color:'#9e7e88',marginTop:2}}>{ch.handle}</div>
                </div>
                <div style={{flex:2,maxWidth:200}}>
                  <div style={{display:'flex',justifyContent:'space-between',fontSize:10,fontWeight:700,color:'#9e7e88',marginBottom:5}}><span>Health</span><span>{ch.pct}%</span></div>
                  <div style={{background:'#f7f3f4',borderRadius:20,height:6,overflow:'hidden'}}>
                    <div style={{height:6,borderRadius:20,background:ch.color,width:`${ch.pct}%`}}/>
                  </div>
                </div>
                <div style={{width:64,textAlign:'center'}}>
                  <span style={{fontSize:9,fontWeight:800,padding:'3px 10px',borderRadius:20,background:s.bg,color:s.color,textTransform:'uppercase',letterSpacing:0.5}}>{s.label}</span>
                </div>
                <button style={{padding:'7px 16px',borderRadius:8,border:'1.5px solid #e4d8dc',background:'#fff',fontSize:12,fontWeight:700,cursor:'pointer',color:'#6b4a55',fontFamily:'Nunito Sans,sans-serif',whiteSpace:'nowrap'}}>
                  {ch.status==='live'?'Configure':ch.status==='setup'?'Connect':'Resume'}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
