'use client';
import {useState,useEffect} from 'react';
import {CheckCircle,XCircle,ExternalLink,RefreshCw} from 'lucide-react';

interface ConnectedPage{pageId:string;pageName:string;pageToken:string;instagramId:string|null;}

export default function ChannelsPage(){
  const [brevoOk,setBrevoOk]=useState<boolean|null>(null);
  const [metaPages,setMetaPages]=useState<ConnectedPage[]>([]);
  const [metaError,setMetaError]=useState<string|null>(null);
  const [metaConnected,setMetaConnected]=useState(false);
  const [liConnected,setLiConnected]=useState(false);
  const [liAccount,setLiAccount]=useState<{name:string;email:string;picture:string;accessToken:string}|null>(null);
  const [liError,setLiError]=useState<string|null>(null);

  useEffect(()=>{
    fetch('/api/brevo/contacts?limit=1').then(r=>setBrevoOk(r.ok)).catch(()=>setBrevoOk(false));
    const params=new URLSearchParams(window.location.search);
    if(params.get('meta_connected')==='true'){
      const pages=params.get('pages');
      if(pages){try{const p=JSON.parse(decodeURIComponent(pages));setMetaPages(p);setMetaConnected(true);localStorage.setItem('roam_meta_pages',JSON.stringify(p));}catch{}}
      window.history.replaceState({},'','/channels');
    }
    if(params.get('meta_error')){setMetaError(params.get('meta_error'));window.history.replaceState({},'','/channels');}
    try{const stored=localStorage.getItem('roam_meta_pages');if(stored){const p=JSON.parse(stored);setMetaPages(p);setMetaConnected(p.length>0);}}catch{}

    // LinkedIn callback
    if(params.get('li_connected')==='true'){
      const acc=params.get('li_account');
      if(acc){try{const a=JSON.parse(decodeURIComponent(acc));setLiAccount(a);setLiConnected(true);localStorage.setItem('roam_li_account',JSON.stringify(a));}catch{}}
      window.history.replaceState({},'','/channels');
    }
    if(params.get('li_error')){setLiError(params.get('li_error'));window.history.replaceState({},'','/channels');}
    try{const s=localStorage.getItem('roam_li_account');if(s){const a=JSON.parse(s);setLiAccount(a);setLiConnected(true);}}catch{}
  },[]);

  function connectMeta(){
    const appId='1319334890088363';
    const redirect=encodeURIComponent('https://roam-crm-platform.netlify.app/api/auth/meta/callback');
    const scope='pages_show_list,pages_read_engagement,pages_manage_posts,public_profile,email';
    window.location.href=`https://www.facebook.com/v19.0/dialog/oauth?client_id=${appId}&redirect_uri=${redirect}&scope=${scope}&response_type=code`;
  }

  function disconnectMeta(){localStorage.removeItem('roam_meta_pages');setMetaPages([]);setMetaConnected(false);}

  function connectLinkedIn(){
    const clientId='86ek07ppuumcbf';
    const redirect=encodeURIComponent('https://roam-crm-platform.netlify.app/api/auth/linkedin/callback');
    const scope='openid%20profile%20email%20w_member_social';
    window.location.href=`https://www.linkedin.com/oauth/v2/authorization?response_type=code&client_id=${clientId}&redirect_uri=${redirect}&scope=${scope}`;
  }

  function disconnectLinkedIn(){localStorage.removeItem('roam_li_account');setLiAccount(null);setLiConnected(false);}

  const btnP:React.CSSProperties={display:'inline-flex',alignItems:'center',gap:6,padding:'8px 16px',borderRadius:'var(--r-md)',background:'var(--maroon-700)',color:'white',fontSize:12.5,fontWeight:600,border:'none',cursor:'pointer'};
  const btnG:React.CSSProperties={display:'inline-flex',alignItems:'center',gap:6,padding:'8px 14px',borderRadius:'var(--r-md)',background:'var(--white)',color:'var(--ink-700)',fontSize:12.5,fontWeight:600,border:'1.5px solid var(--ink-200)',cursor:'pointer'};
  const btnFB:React.CSSProperties={display:'inline-flex',alignItems:'center',gap:8,padding:'12px 22px',borderRadius:'var(--r-md)',background:'#1877F2',color:'white',fontSize:14,fontWeight:600,border:'none',cursor:'pointer'};

  return(
    <div style={{padding:'24px 28px'}}>
      <div style={{marginBottom:24}}>
        <h1 style={{fontFamily:'var(--font-display)',fontSize:28,fontWeight:700,color:'var(--ink-900)',lineHeight:1,marginBottom:6}}>Channels</h1>
        <p style={{fontSize:12,color:'var(--ink-400)',fontWeight:500}}>Connect your social media accounts to publish directly from the Social Calendar</p>
      </div>

      {metaError&&<div style={{background:'#fcebeb',border:'1px solid #f5c2c7',borderRadius:'var(--r-md)',padding:'12px 16px',marginBottom:16,fontSize:13,color:'var(--alert)'}}>Connection failed: {metaError}. Please try again.</div>}

      <div style={{display:'flex',flexDirection:'column',gap:12}}>

        {/* Brevo */}
        <div style={{background:'var(--white)',border:'1px solid var(--ink-100)',borderRadius:'var(--r-lg)',padding:'18px 20px',display:'flex',alignItems:'center',gap:14}}>
          <div style={{width:42,height:42,borderRadius:'var(--r-md)',background:'#e8f5ee',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M4 4h16M4 9h16M4 14h16M4 19h16" stroke="#2f7a4f" strokeWidth="1.5" strokeLinecap="round"/></svg>
          </div>
          <div style={{flex:1}}>
            <div style={{fontSize:14,fontWeight:600,color:'var(--ink-900)'}}>Brevo Email</div>
            <div style={{fontSize:12,color:'var(--ink-500)',marginTop:2}}>Transactional email · hello@roam-everywhere.com · 500 contacts</div>
          </div>
          {brevoOk===null?<span style={{fontSize:12,color:'var(--ink-400)'}}>Checking...</span>:brevoOk?<span style={{display:'flex',alignItems:'center',gap:5,fontSize:12,color:'var(--ok)',fontWeight:500}}><CheckCircle size={14}/>Connected</span>:<span style={{display:'flex',alignItems:'center',gap:5,fontSize:12,color:'var(--alert)',fontWeight:500}}><XCircle size={14}/>Error</span>}
        </div>

        {/* Facebook + Instagram */}
        <div style={{background:'var(--white)',border:'1px solid var(--ink-100)',borderRadius:'var(--r-lg)',overflow:'hidden'}}>
          <div style={{padding:'18px 20px',display:'flex',alignItems:'center',gap:14}}>
            <div style={{width:42,height:42,borderRadius:'var(--r-md)',background:'#dde9f7',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M18 2h-3a5 5 0 00-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 011-1h3z" stroke="#1877F2" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </div>
            <div style={{flex:1}}>
              <div style={{fontSize:14,fontWeight:600,color:'var(--ink-900)'}}>Facebook Pages + Instagram</div>
              <div style={{fontSize:12,color:'var(--ink-500)',marginTop:2}}>
                {metaConnected?`${metaPages.length} page${metaPages.length===1?'':'s'} connected · ${metaPages.filter(p=>p.instagramId).length} with Instagram`:'Connect your Facebook account to link all Pages and Instagram accounts in one click'}
              </div>
            </div>
            <div style={{display:'flex',gap:8,flexShrink:0}}>
              {metaConnected?(
                <>
                  <span style={{display:'flex',alignItems:'center',gap:5,fontSize:12,color:'var(--ok)',fontWeight:500,marginRight:4}}><CheckCircle size={14}/>Connected</span>
                  <button onClick={connectMeta} style={{...btnG,fontSize:11,padding:'6px 12px'}}><RefreshCw size={12}/>Reconnect</button>
                  <button onClick={disconnectMeta} style={{...btnG,fontSize:11,padding:'6px 12px',color:'var(--alert)',borderColor:'#f5c2c7'}}>Disconnect</button>
                </>
              ):(
                <button onClick={connectMeta} style={btnFB}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="white"><path d="M18 2h-3a5 5 0 00-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 011-1h3z"/></svg>
                  Connect with Facebook
                </button>
              )}
            </div>
          </div>

          {metaConnected&&metaPages.length>0&&(
            <div style={{borderTop:'1px solid var(--ink-100)'}}>
              {metaPages.map(page=>(
                <div key={page.pageId} style={{padding:'12px 20px',borderBottom:'1px solid var(--ink-100)',display:'flex',alignItems:'center',gap:12}}>
                  <div style={{width:32,height:32,borderRadius:'50%',background:'#dde9f7',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0,fontSize:13,fontWeight:700,color:'#1877F2'}}>{page.pageName.charAt(0)}</div>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:13,fontWeight:500,color:'var(--ink-900)'}}>{page.pageName}</div>
                    <div style={{display:'flex',gap:6,marginTop:3,flexWrap:'wrap'}}>
                      <span style={{fontSize:10,padding:'2px 7px',borderRadius:'var(--r-pill)',background:'#dde9f7',color:'#1877F2',fontWeight:500}}>Facebook Page</span>
                      {page.instagramId&&<span style={{fontSize:10,padding:'2px 7px',borderRadius:'var(--r-pill)',background:'#fbeaef',color:'var(--maroon-600)',fontWeight:500}}>Instagram</span>}
                    </div>
                  </div>
                  <CheckCircle size={16} color="var(--ok)"/>
                </div>
              ))}
            </div>
          )}

          {!metaConnected&&(
            <div style={{padding:'16px 20px',borderTop:'1px solid var(--ink-100)',background:'var(--paper)',fontSize:11,color:'var(--ink-400)',lineHeight:1.6}}>
              Clicking "Connect with Facebook" will open Facebook login. Select which Pages and Instagram accounts to grant access to. You'll be redirected back here automatically.
            </div>
          )}
        </div>

        {/* LinkedIn */}
        <div style={{background:'var(--white)',border:'1px solid var(--ink-100)',borderRadius:'var(--r-lg)',padding:'18px 20px',display:'flex',alignItems:'center',gap:14}}>
          <div style={{width:42,height:42,borderRadius:'var(--r-md)',background:'#e8f0fb',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M16 8a6 6 0 016 6v7h-4v-7a2 2 0 00-2-2 2 2 0 00-2 2v7h-4v-7a6 6 0 016-6z" stroke="#185FA5" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/><rect x="2" y="9" width="4" height="12" stroke="#185FA5" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/><circle cx="4" cy="4" r="2" stroke="#185FA5" strokeWidth="1.5"/></svg>
          </div>
          <div style={{flex:1}}>
            <div style={{fontSize:14,fontWeight:600,color:'var(--ink-900)'}}>LinkedIn</div>
            <div style={{fontSize:12,color:'var(--ink-500)',marginTop:2}}>Apply for API access — approval takes 3-7 days</div>
          </div>
          <a href="https://linkedin.com/developers" target="_blank" rel="noopener noreferrer" style={{...btnG,fontSize:11,padding:'6px 12px',textDecoration:'none'}}><ExternalLink size={12}/>Apply for access</a>
        </div>

        {/* LinkedIn */}
        <div style={{background:'var(--white)',border:'1px solid var(--ink-100)',borderRadius:'var(--r-lg)',overflow:'hidden'}}>
          <div style={{padding:'18px 20px',display:'flex',alignItems:'center',gap:14}}>
            <div style={{width:42,height:42,borderRadius:'var(--r-md)',background:'#e8f0fb',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M16 8a6 6 0 016 6v7h-4v-7a2 2 0 00-2-2 2 2 0 00-2 2v7h-4v-7a6 6 0 016-6z" stroke="#185FA5" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/><rect x="2" y="9" width="4" height="12" stroke="#185FA5" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/><circle cx="4" cy="4" r="2" stroke="#185FA5" strokeWidth="1.5"/></svg>
            </div>
            <div style={{flex:1}}>
              <div style={{fontSize:14,fontWeight:600,color:'var(--ink-900)'}}>LinkedIn</div>
              <div style={{fontSize:12,color:'var(--ink-500)',marginTop:2}}>{liConnected?`Connected as ${liAccount?.name}`:'Connect your LinkedIn account to post from the Social Calendar'}</div>
            </div>
            <div style={{display:'flex',gap:8,flexShrink:0,alignItems:'center'}}>
              {liConnected?(
                <>
                  <span style={{display:'flex',alignItems:'center',gap:5,fontSize:12,color:'var(--ok)',fontWeight:500}}><CheckCircle size={14}/>Connected</span>
                  <button onClick={connectLinkedIn} style={{...btnG,fontSize:11,padding:'6px 12px'}}><RefreshCw size={12}/>Reconnect</button>
                  <button onClick={disconnectLinkedIn} style={{...btnG,fontSize:11,padding:'6px 12px',color:'var(--alert)',borderColor:'#f5c2c7'}}>Disconnect</button>
                </>
              ):(
                <button onClick={connectLinkedIn} style={{...btnP,background:'#0A66C2',display:'inline-flex',alignItems:'center',gap:8}}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="white"><path d="M16 8a6 6 0 016 6v7h-4v-7a2 2 0 00-2-2 2 2 0 00-2 2v7h-4v-7a6 6 0 016-6z"/><rect x="2" y="9" width="4" height="12" fill="white"/><circle cx="4" cy="4" r="2" fill="white"/></svg>
                  Connect LinkedIn
                </button>
              )}
            </div>
          </div>
          {liConnected&&liAccount&&(
            <div style={{borderTop:'1px solid var(--ink-100)',padding:'12px 20px',display:'flex',alignItems:'center',gap:10}}>
              {liAccount.picture&&<img src={liAccount.picture} style={{width:32,height:32,borderRadius:'50%',flexShrink:0}} alt=""/>}
              <div>
                <div style={{fontSize:13,fontWeight:500,color:'var(--ink-900)'}}>{liAccount.name}</div>
                <div style={{fontSize:11,color:'var(--ink-400)'}}>{liAccount.email}</div>
              </div>
              <CheckCircle size={16} color="var(--ok)" style={{marginLeft:'auto'}}/>
            </div>
          )}
          {liError&&<div style={{padding:'10px 20px',borderTop:'1px solid var(--ink-100)',fontSize:12,color:'var(--alert)'}}>Connection failed: {liError}. Please try again.</div>}
        </div>

        {/* X/Twitter */}
        <div style={{background:'var(--white)',border:'1px solid var(--ink-100)',borderRadius:'var(--r-lg)',padding:'18px 20px',display:'flex',alignItems:'center',gap:14}}>
          <div style={{width:42,height:42,borderRadius:'var(--r-md)',background:'#f0f0f0',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M4 4l16 16M4 20L20 4" stroke="#333" strokeWidth="1.5" strokeLinecap="round"/></svg>
          </div>
          <div style={{flex:1}}>
            <div style={{fontSize:14,fontWeight:600,color:'var(--ink-900)'}}>X / Twitter</div>
            <div style={{fontSize:12,color:'var(--ink-500)',marginTop:2}}>Apply for developer access at developer.twitter.com</div>
          </div>
          <a href="https://developer.twitter.com" target="_blank" rel="noopener noreferrer" style={{...btnG,fontSize:11,padding:'6px 12px',textDecoration:'none'}}><ExternalLink size={12}/>Apply for access</a>
        </div>

      </div>
    </div>
  );
}
