export default function SequencesPage() {
  const steps = [
    {num:1,done:true,title:'First Contact — Introduction',meta:'Sent immediately · Personalised per town',preview:'Subject: Free listing for [Business] on Roam\n\nHi [Name], we\'ve built a page for [Town] on Roam — a free local discovery app. [Town] is known for [known_for], and we\'d love [Business] to be part of it. Listing takes 90 seconds and is completely free.'},
    {num:2,done:true,title:'Follow-up — Social proof',meta:'Day 2 if no response · Short and light',preview:'Subject: Just checking in — [Town] on Roam\n\nHi [Name], just a quick nudge — listing [Business] takes 90 seconds and is free. [X] businesses in [Region] are already live.'},
    {num:3,done:false,title:'Final nudge — Last chance',meta:'Day 7 if no response · Last attempt',preview:'Subject: Last one from us — [Business]\n\nWe won\'t chase again after this. If you\'d like [Business] featured on Roam\'s [Town] page, here\'s the link…'},
    {num:4,done:false,title:'Mark as Cold',meta:'Day 14 · Archived automatically',preview:'Business is marked cold in the pipeline. Can be re-activated after 90 days.'},
  ];
  return (
    <div className="page-pad">
      <div style={{marginBottom:20}}>
        <h1 style={{fontFamily:'Nunito,sans-serif',fontSize:22,fontWeight:900,color:'#1a0d12',margin:0}}>Email Sequences</h1>
        <p style={{fontSize:12,color:'#9e7e88',margin:'3px 0 0',fontWeight:500}}>Automated 3-step outreach · personalised per town using your city page data</p>
      </div>
      <div className="grid-seq">
        <div style={{background:'#fff',border:'1px solid #e4d8dc',borderRadius:12,overflow:'hidden'}}>
          <div style={{padding:'15px 20px',borderBottom:'1px solid #e4d8dc',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
            <div style={{fontFamily:'Nunito,sans-serif',fontSize:14,fontWeight:800}}>✉ Outreach Sequence</div>
            <button style={{fontSize:11,fontWeight:700,color:'#8B1A3A',background:'none',border:'none',cursor:'pointer'}}>Edit templates</button>
          </div>
          <div style={{padding:'20px'}}>
            {steps.map((s,i)=>(
              <div key={i} style={{display:'flex',gap:14,marginBottom:20,position:'relative'}}>
                {i<steps.length-1&&<div style={{position:'absolute',left:15,top:34,bottom:-12,width:2,background:'#e4d8dc'}}/>}
                <div style={{width:32,height:32,borderRadius:'50%',background:s.done?'#8B1A3A':'#f7f3f4',border:s.done?'none':'2px solid #e4d8dc',color:s.done?'#fff':'#9e7e88',display:'flex',alignItems:'center',justifyContent:'center',fontSize:12,fontWeight:800,flexShrink:0,zIndex:1}}>{s.done?'✓':s.num}</div>
                <div style={{flex:1,paddingTop:4}}>
                  <div style={{fontSize:13,fontWeight:700,marginBottom:2}}>{s.title}</div>
                  <div style={{fontSize:11,color:'#9e7e88',marginBottom:8}}>{s.meta}</div>
                  <div style={{background:'#f7f3f4',borderRadius:8,padding:'10px 12px',fontSize:11,color:'#6b4a55',lineHeight:1.6,whiteSpace:'pre-line'}}>{s.preview}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div style={{display:'flex',flexDirection:'column',gap:18}}>
          <div style={{background:'#fff',border:'1px solid #e4d8dc',borderRadius:12,padding:20}}>
            <div style={{fontFamily:'Nunito,sans-serif',fontSize:14,fontWeight:800,marginBottom:16}}>∿ Sequence Stats</div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
              {[{v:'68%',l:'Open Rate',c:'#8B1A3A'},{v:'24%',l:'List Rate',c:'#2d7a4f'},{v:'134',l:'In Sequence',c:'#1a6b9a'},{v:'23',l:'Follow-up Due',c:'#b06820'}].map(s=>(
                <div key={s.l} style={{textAlign:'center',padding:'14px 8px',background:'#f7f3f4',borderRadius:8}}>
                  <div style={{fontFamily:'Nunito,sans-serif',fontSize:26,fontWeight:900,color:s.c}}>{s.v}</div>
                  <div style={{fontSize:10,fontWeight:700,color:'#9e7e88',marginTop:4,textTransform:'uppercase',letterSpacing:0.5}}>{s.l}</div>
                </div>
              ))}
            </div>
          </div>
          <div style={{background:'#fff',border:'1px solid #e4d8dc',borderRadius:12,padding:20}}>
            <div style={{fontFamily:'Nunito,sans-serif',fontSize:14,fontWeight:800,marginBottom:16}}>⚙ Settings</div>
            {[{l:'Sending account',v:'hello@roam-local.co.uk'},{l:'Send time',v:'Tue–Thu 9–11am'},{l:'Follow-up delay',v:'2 days'},{l:'Final nudge',v:'Day 7'}].map(s=>(
              <div key={s.l} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'10px 0',borderBottom:'1px solid #f0e8ea'}}>
                <span style={{fontSize:12,fontWeight:600,color:'#6b4a55'}}>{s.l}</span>
                <span style={{fontSize:12,fontWeight:700,color:'#1a0d12'}}>{s.v}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
