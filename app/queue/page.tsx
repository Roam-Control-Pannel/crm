'use client';
const items = [
  {icon:'📸',title:'Instagram post ready',desc:'Whitstable oyster scene — generated from page data',town:'Whitstable',time:'today 3pm',overdue:false},
  {icon:'✉️',title:'Follow-up email · Aberfeldy Bakehouse',desc:'Day 4 sequence — opened email, no response',town:'Aberfeldy',time:'overdue 2h',overdue:true},
  {icon:'💼',title:'LinkedIn post — Ludlow businesses',desc:'Free listing pitch for local SMEs',town:'Ludlow',time:'today 5pm',overdue:false},
  {icon:'📸',title:'Instagram Story — Totnes market day',desc:'Weekly content — pulled from known-for data',town:'Totnes',time:'tomorrow 9am',overdue:false},
];
export default function QueuePage() {
  return (
    <div className="page-pad">
      <div style={{marginBottom:20}}>
        <h1 style={{fontFamily:'Nunito,sans-serif',fontSize:22,fontWeight:900,color:'#1a0d12',margin:0}}>Today's Queue</h1>
        <p style={{fontSize:12,color:'#9e7e88',margin:'3px 0 0',fontWeight:500}}>{items.length} items awaiting approval · nothing sends without your sign-off</p>
      </div>
      <div style={{background:'#fff',border:'1px solid #e4d8dc',borderRadius:12,overflow:'hidden'}}>
        {items.map((item,i)=>(
          <div key={i} className="queue-row" style={{display:'flex',alignItems:'flex-start',gap:14,padding:'16px 20px',borderBottom:i<items.length-1?'1px solid #e4d8dc':'none'}}>
            <div style={{width:38,height:38,borderRadius:10,background:item.overdue?'#fdf0e4':'#f9eaee',display:'flex',alignItems:'center',justifyContent:'center',fontSize:17,flexShrink:0}}>{item.icon}</div>
            <div style={{flex:1}}>
              <div style={{fontSize:13,fontWeight:700,marginBottom:3}}>{item.title}</div>
              <div style={{fontSize:11,color:'#9e7e88',fontWeight:500}}>{item.desc}</div>
              <div style={{display:'flex',gap:8,marginTop:10}}>
                <button onClick={()=>alert('Approved!')} style={{display:'inline-flex',alignItems:'center',gap:5,background:'linear-gradient(135deg,#6B1230,#8B1A3A)',color:'#fff',fontSize:11,fontWeight:700,padding:'6px 14px',borderRadius:6,border:'none',cursor:'pointer',fontFamily:'Nunito Sans,sans-serif'}}>✓ Approve</button>
                <button style={{display:'inline-flex',alignItems:'center',gap:5,background:'transparent',color:'#9e7e88',fontSize:11,fontWeight:700,padding:'6px 12px',borderRadius:6,border:'1.5px solid #e4d8dc',cursor:'pointer',fontFamily:'Nunito Sans,sans-serif'}}>✎ Edit</button>
                <button style={{display:'inline-flex',alignItems:'center',gap:5,background:'transparent',color:'#9e7e88',fontSize:11,fontWeight:700,padding:'6px 12px',borderRadius:6,border:'1.5px solid #e4d8dc',cursor:'pointer',fontFamily:'Nunito Sans,sans-serif'}}>✕ Skip</button>
              </div>
            </div>
            <div className="queue-meta" style={{flexShrink:0,textAlign:'right'}}>
              <div style={{fontSize:11,fontWeight:800,color:'#8B1A3A'}}>{item.town}</div>
              <div style={{fontSize:10,color:item.overdue?'#8B1A3A':'#9e7e88',fontWeight:600,marginTop:2}}>{item.time}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
