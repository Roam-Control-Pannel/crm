import Link from 'next/link';

export default function SocialPage() {
  return (
    <div className="page-pad">
      <div style={{marginBottom:20}}>
        <h1 style={{fontFamily:'Nunito,sans-serif',fontSize:22,fontWeight:900,color:'#1a0d12',margin:0}}>Social Posts</h1>
        <p style={{fontSize:12,color:'#9e7e88',margin:'3px 0 0',fontWeight:500}}>Schedule and manage posts across Instagram, LinkedIn and X</p>
      </div>
      <div style={{background:'#fff',border:'1px solid #e4d8dc',borderRadius:12,padding:40,textAlign:'center'}}>
        <div style={{fontSize:40,marginBottom:16}}>📅</div>
        <div style={{fontFamily:'Nunito,sans-serif',fontSize:18,fontWeight:800,marginBottom:8}}>Social Scheduler</div>
        <div style={{fontSize:13,color:'#9e7e88',marginBottom:24,maxWidth:400,margin:'0 auto 24px'}}>Connect your Instagram and LinkedIn accounts in Channels, then come back here to schedule and approve posts for each town.</div>
        <Link href="/channels" style={{display:'inline-flex',alignItems:'center',gap:6,padding:'10px 20px',borderRadius:8,fontSize:13,fontWeight:700,background:'linear-gradient(135deg,#6B1230,#8B1A3A)',color:'#fff',textDecoration:'none',boxShadow:'0 2px 8px rgba(139,26,58,0.28)'}}>⚙ Set up Channels →</Link>
      </div>
    </div>
  );
}
