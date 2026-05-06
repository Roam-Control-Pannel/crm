'use client';
import {useState,useEffect} from 'react';
import {Plus,Calendar,List,X,Image,Sparkles,ChevronLeft,ChevronRight,Check,Clock,Edit3,Trash2} from 'lucide-react';
import {addNotification} from '@/components/NotificationCentre';

interface PostResult{status:'pending'|'publishing'|'published'|'failed';postId?:string;postUrl?:string;error?:string;publishedAt?:string;}
interface SocialPost{id:string;accountIds:string[];town:string;caption:string;imageUrl?:string;imageCredit?:string;scheduledAt:string;status:'draft'|'scheduled'|'publishing'|'published'|'partial'|'failed';createdAt:string;results?:Record<string,PostResult>;}
interface SocialAccount{id:string;handle:string;platform:'instagram'|'facebook'|'linkedin'|'x';region?:string;audience:string;tone:string;contentBrief:string;hashtags:string;color:string;active:boolean;}

const PLATFORM_COLORS:Record<string,{bg:string;border:string;text:string}>={
  instagram:{bg:'#fbeaef',border:'#9b2752',text:'#6B1230'},
  facebook:{bg:'#dde9f7',border:'#3b5998',text:'#1a3a6b'},
  linkedin:{bg:'#e8f0fb',border:'#185FA5',text:'#0C447C'},
  x:{bg:'#f0f0f0',border:'#333',text:'#111'},
};

const DEFAULT_ACCOUNTS:SocialAccount[]=[
  {id:'acc1',handle:'@roamlocalapp',platform:'instagram',region:'UK',audience:'Local explorers, town visitors, food lovers',tone:'Warm, visual, discovery-led, inspiring',contentBrief:'Town features, hidden gems, food scenes, independent businesses',hashtags:'#RoamLocal #HiddenGems #IndependentBusiness #LocalLove',color:'#9b2752',active:true},
  {id:'acc2',handle:'@roam_ni',platform:'instagram',region:'Northern Ireland',audience:'Northern Ireland locals, NI visitors, NI business owners',tone:'Local pride, community warmth, NI personality',contentBrief:'NI towns, local businesses, NI food and culture, community stories',hashtags:'#RoamNI #NorthernIreland #LoveNI #NIBusiness',color:'#c47a1a',active:true},
  {id:'acc3',handle:'Roam Local',platform:'facebook',region:'UK',audience:'Local community, families, town residents',tone:'Friendly, community-first, conversational',contentBrief:'Local events, community news, business spotlights, town life',hashtags:'#LocalLife #CommunityFirst #ShopLocal',color:'#3b5998',active:true},
  {id:'acc4',handle:'Roam NI',platform:'facebook',region:'Northern Ireland',audience:'NI community, local families, NI residents',tone:'Warm NI voice, community pride, inclusive',contentBrief:'NI community news, local events, business features',hashtags:'#RoamNI #NICommunity #LoveNI',color:'#2f7a4f',active:true},
  {id:'acc5',handle:'@roamforbusiness',platform:'linkedin',region:'UK',audience:'Local business owners, entrepreneurs, SME decision makers',tone:'Professional, growth-focused, empowering',contentBrief:'Business spotlights, listing benefits, growth stats, founder stories',hashtags:'#LocalBusiness #IndependentBusiness #SmallBusiness',color:'#185FA5',active:true},
];

const MONTHS=['January','February','March','April','May','June','July','August','September','October','November','December'];
const TOWNS=['Whitstable','Darlington','Aberfeldy','London','Edinburgh','Bristol','Manchester','Leeds','Belfast','Derry'];

function getPosts():SocialPost[]{try{
  const v=localStorage.getItem('roam_social_posts_v');
  if(v!=='2'){
    // v2 migration: wipe (per user request: start fresh)
    localStorage.setItem('roam_social_posts','[]');
    localStorage.setItem('roam_social_posts_v','2');
    return [];
  }
  const raw=JSON.parse(localStorage.getItem('roam_social_posts')||'[]');
  // Defensive migration: convert any lingering accountId entries to accountIds
  return raw.map((p:any)=>{
    if(p.accountIds) return p;
    if(p.accountId) return {...p,accountIds:[p.accountId]};
    return {...p,accountIds:[]};
  });
}catch{return[];}}
function savePosts(p:SocialPost[]){try{localStorage.setItem('roam_social_posts',JSON.stringify(p));}catch{}}
function getAccounts():SocialAccount[]{try{const s=localStorage.getItem('roam_accounts');return s?JSON.parse(s):DEFAULT_ACCOUNTS;}catch{return DEFAULT_ACCOUNTS;}}
function getDays(y:number,m:number):number{return new Date(y,m+1,0).getDate();}
function getFirst(y:number,m:number):number{const d=new Date(y,m,1).getDay();return d===0?6:d-1;}

function PlatformIcon({platform,size=12,color}:{platform:string;size?:number;color?:string}){
  const c=color||PLATFORM_COLORS[platform]?.text||'currentColor';
  if(platform==='instagram')return<svg width={size} height={size} viewBox="0 0 24 24" fill="none"><rect x="2" y="2" width="20" height="20" rx="5" stroke={c} strokeWidth="1.5"/><circle cx="12" cy="12" r="4" stroke={c} strokeWidth="1.5"/><circle cx="17.5" cy="6.5" r="1" fill={c}/></svg>;
  if(platform==='facebook')return<svg width={size} height={size} viewBox="0 0 24 24" fill="none"><path d="M18 2h-3a5 5 0 00-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 011-1h3z" stroke={c} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>;
  if(platform==='linkedin')return<svg width={size} height={size} viewBox="0 0 24 24" fill="none"><path d="M16 8a6 6 0 016 6v7h-4v-7a2 2 0 00-2-2 2 2 0 00-2 2v7h-4v-7a6 6 0 016-6z" stroke={c} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/><rect x="2" y="9" width="4" height="12" stroke={c} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/><circle cx="4" cy="4" r="2" stroke={c} strokeWidth="1.5"/></svg>;
  return<svg width={size} height={size} viewBox="0 0 24 24" fill="none"><path d="M4 4l16 16M4 20L20 4" stroke={c} strokeWidth="1.5" strokeLinecap="round"/></svg>;
}

export default function SocialPage(){
  const [tab,setTab]=useState<'calendar'|'list'>('calendar');
  const [posts,setPosts]=useState<SocialPost[]>([]);
  const [accounts,setAccounts]=useState<SocialAccount[]>([]);
  const [acctFilter,setAcctFilter]=useState('all');
  const [platFilter,setPlatFilter]=useState('all');
  const [showComposer,setShowComposer]=useState(false);
  const [showGen,setShowGen]=useState(false);
  const [editPost,setEditPost]=useState<SocialPost|null>(null);
  const [generating,setGenerating]=useState(false);
  const [searchingImgs,setSearchingImgs]=useState(false);
  const [unsplash,setUnsplash]=useState<{url:string;thumb:string;credit:string}[]>([]);
  const today=new Date();
  const [calY,setCalY]=useState(today.getFullYear());
  const [calM,setCalM]=useState(today.getMonth());

  
  const blankForm=()=>({accountIds:accounts.filter(a=>a.active).map(a=>a.id),town:'Whitstable',caption:'',imageUrl:'',imageCredit:'',scheduledDate:today.toISOString().split('T')[0],scheduledTime:'10:00',status:'draft' as SocialPost['status']});
  const [form,setForm]=useState(blankForm());
  const [genForm,setGenForm]=useState({town:'Whitstable',accountIds:[] as string[],postsPerAccount:3,weekStart:today.toISOString().split('T')[0]});

  useEffect(()=>{
    const accs=getAccounts();
    setAccounts(accs);
    setPosts(getPosts());
    setGenForm(f=>({...f,accountIds:accs.filter(a=>a.active).map(a=>a.id)}));
  },[]);

  function saveAndSet(p:SocialPost[]){setPosts(p);savePosts(p);}

  function getAccount(id:string):SocialAccount|undefined{return accounts.find(a=>a.id===id);}

  function openComposer(post?:SocialPost){
    if(post){
      setEditPost(post);
      const dt=new Date(post.scheduledAt);
      setForm({accountIds:(post as any).accountIds||((post as any).accountId?[(post as any).accountId]:[]),town:post.town,caption:post.caption,imageUrl:post.imageUrl||'',imageCredit:post.imageCredit||'',scheduledDate:dt.toISOString().split('T')[0],scheduledTime:dt.toTimeString().slice(0,5),status:post.status});
    }else{setEditPost(null);setForm(blankForm());}
    setUnsplash([]);setShowComposer(true);
  }

  function savePost(){
    if(!form.caption.trim())return;
    const scheduledAt=new Date(form.scheduledDate+'T'+form.scheduledTime).toISOString();
    if(editPost){saveAndSet(posts.map(p=>p.id===editPost.id?{...p,...form,scheduledAt}
:p));}
    else{
      const np:SocialPost={id:Date.now().toString(),...form,scheduledAt,createdAt:new Date().toISOString()};
      saveAndSet([np,...posts]);
      const acc=getAccount(form.accountIds?.[0]||'');
      addNotification({type:'info',title:'Post created',body:(acc?.handle||'Post')+' scheduled for '+form.scheduledDate});
    }
    setShowComposer(false);
  }

  // ============== Publishing ==============
  const [publishing,setPublishing]=useState<string|null>(null);
  const [confirmPublish,setConfirmPublish]=useState<SocialPost|null>(null);

  function platformOrder(platform:string):number{
    if(platform==='linkedin') return 0;
    if(platform==='facebook') return 1;
    if(platform==='instagram') return 2;
    return 3;
  }

  async function publishPost(post:SocialPost){
    setPublishing(post.id);
    const accs=accounts.filter(a=>post.accountIds.includes(a.id));
    accs.sort((a,b)=>platformOrder(a.platform)-platformOrder(b.platform));

    const results:Record<string,any>={...(post.results||{})};
    accs.forEach(a=>{ if(!results[a.id]) results[a.id]={status:'pending'}; });

    let metaPagesByPlatform:Record<string,string>={};
    try{
      const sRes=await fetch('/api/accounts/status');
      const sData=await sRes.json();
      const pages=sData.meta?.pages||[];
      if(pages.length>0){
        metaPagesByPlatform.facebook=pages[0].id;
        metaPagesByPlatform.instagram=pages.find((p:any)=>p.hasInstagram)?.id||pages[0].id;
      }
    }catch(e){console.error('Failed to fetch meta pages:',e);}

    for(const a of accs){
      results[a.id]={status:'publishing'};
      saveAndSet(posts.map(p=>p.id===post.id?{...p,results:{...results}}:p));

      try{
        const res=await fetch('/api/social/publish',{
          method:'POST',
          headers:{'Content-Type':'application/json'},
          body:JSON.stringify({
            accountId:a.id,
            platform:a.platform,
            caption:post.caption,
            imageUrl:post.imageUrl||undefined,
            metaPageId:metaPagesByPlatform[a.platform],
          }),
        });
        const data=await res.json();
        if(data.ok){
          results[a.id]={status:'published',postId:data.postId,postUrl:data.postUrl,publishedAt:new Date().toISOString()};
          addNotification({type:'success',title:`Published to ${a.handle}`,description:a.platform});
        }else{
          results[a.id]={status:'failed',error:data.error||'Unknown error'};
          addNotification({type:'error',title:`Failed: ${a.handle}`,description:data.error||'Unknown'});
        }
      }catch(err:any){
        results[a.id]={status:'failed',error:err?.message||'Network error'};
        addNotification({type:'error',title:`Failed: ${a.handle}`,description:err?.message||'Network error'});
      }
      saveAndSet(posts.map(p=>p.id===post.id?{...p,results:{...results}}:p));
    }

    const all=Object.values(results);
    const succeeded=all.filter((r:any)=>r.status==='published').length;
    const failed=all.filter((r:any)=>r.status==='failed').length;
    let summary:SocialPost['status']='partial';
    if(succeeded===all.length) summary='published';
    else if(failed===all.length) summary='failed';

    saveAndSet(posts.map(p=>p.id===post.id?{...p,results:{...results},status:summary}:p));
    setPublishing(null);
    setConfirmPublish(null);
  }


  async function searchUnsplash(){
    setSearchingImgs(true);setUnsplash([]);
    try{const res=await fetch('/api/images/search?query='+encodeURIComponent(form.town+' town')+'&count=6');const d=await res.json();setUnsplash(d.images||[]);}catch{}
    setSearchingImgs(false);
  }

  async function generate(){
    setGenerating(true);
    const selectedAccounts=accounts.filter(a=>genForm.accountIds.includes(a.id));
    if(!selectedAccounts.length){setGenerating(false);return;}
    try{
      for(const acc of selectedAccounts){
        const res=await fetch('/api/ai/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
          maxTokens:2000,
          systemPrompt:'You are a social media content generator. Return ONLY a valid JSON array, no markdown or explanation.',
          messages:[{role:'user',content:`Generate ${genForm.postsPerAccount} social media posts for the account "${acc.handle}" on ${acc.platform}.

Account strategy brief:
- Audience: ${acc.audience}
- Tone: ${acc.tone}
- Content: ${acc.contentBrief}
- Default hashtags: ${acc.hashtags}
- Region focus: ${acc.region||'UK'}

Town to write about: ${genForm.town}

Write posts that match this account's voice exactly. Include the default hashtags naturally.

Return JSON array: [{"caption":"post text here","scheduledDay":1},{"caption":"post text","scheduledDay":3}]`}],
        })});
        const d=await res.json();
        let raw=(d.content||'[]').replace(/\`\`\`json/g,'').replace(/\`\`\`/g,'').trim();
        if(!raw.startsWith('['))raw='[]';
        const gen=JSON.parse(raw);
        const start=new Date(genForm.weekStart);
        const newPosts:SocialPost[]=gen.map((g:Record<string,unknown>,i:number)=>{
          const dt=new Date(start);
          const day=typeof g.scheduledDay==='number'?g.scheduledDay:i;
          dt.setDate(dt.getDate()+day);dt.setHours(10,0,0,0);
          return{id:(Date.now()+Math.random()*1000).toString(),accountId:acc.id,town:genForm.town,caption:(g.caption as string)||'',scheduledAt:dt.toISOString(),status:'draft' as const,createdAt:new Date().toISOString(),imageUrl:'',imageCredit:''};
        });
        saveAndSet([...newPosts,...getPosts()]);
      }
      setPosts(getPosts());
      addNotification({type:'info',title:'Content generated',body:'Posts created for '+genForm.town+' across '+selectedAccounts.length+' accounts'});
      setShowGen(false);
    }catch(e){console.error(e);}
    setGenerating(false);
  }

  const filtered=posts.filter(p=>{
    const acc=getAccount(p.accountId);
    if(acctFilter!=='all'&&p.accountId!==acctFilter)return false;
    if(platFilter!=='all'&&acc?.platform!==platFilter)return false;
    return true;
  });

  const scheduled=filtered.filter(p=>p.status==='scheduled');
  const drafts=filtered.filter(p=>p.status==='draft');
  const published=filtered.filter(p=>p.status==='published');

  const inp:React.CSSProperties={padding:'8px 12px',border:'1.5px solid var(--ink-200)',borderRadius:'var(--r-md)',fontSize:13,fontFamily:'inherit',background:'var(--white)',color:'var(--ink-900)',outline:'none',width:'100%'};
  const btnP:React.CSSProperties={display:'inline-flex',alignItems:'center',gap:6,padding:'8px 16px',borderRadius:'var(--r-md)',background:'var(--maroon-700)',color:'white',fontSize:12.5,fontWeight:600,border:'none',cursor:'pointer',whiteSpace:'nowrap' as const};
  const btnG:React.CSSProperties={display:'inline-flex',alignItems:'center',gap:6,padding:'8px 14px',borderRadius:'var(--r-md)',background:'var(--white)',color:'var(--ink-700)',fontSize:12.5,fontWeight:600,border:'1.5px solid var(--ink-200)',cursor:'pointer',whiteSpace:'nowrap' as const};

  const daysInMonth=getDays(calY,calM);
  const firstDay=getFirst(calY,calM);
  const calDays=Array.from({length:42},(_,i)=>{const d=i-firstDay+1;return d>=1&&d<=daysInMonth?d:null;});
  function postsForDay(day:number){return filtered.filter(p=>{const d=new Date(p.scheduledAt);return d.getFullYear()===calY&&d.getMonth()===calM&&d.getDate()===day;});}

  const PostPill=({post}:{post:SocialPost})=>{
    const acc=getAccount(post.accountIds?.[0]);
    const color=acc?.color||'#9b2752';
    return(
      <div onClick={(e)=>{e.stopPropagation();openComposer(post);}} style={{borderLeft:'2px solid '+color,background:color+'22',borderRadius:3,padding:'2px 5px',marginBottom:2,cursor:'pointer',overflow:'hidden'}}>
        <div style={{display:'flex',alignItems:'center',gap:3}}>
          {acc&&<PlatformIcon platform={acc.platform} size={9} color={color}/>}
          <span style={{fontSize:9,color:color,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',maxWidth:70,fontWeight:500,opacity:post.status==='draft'?0.7:1}}>{acc?.handle||'Unknown'}</span>
        </div>
      </div>
    );
  };

  const PostRow=({post}:{post:SocialPost})=>{
    const acc=getAccount(post.accountIds?.[0]);
    const color=acc?.color||'#9b2752';
    const pc=acc?PLATFORM_COLORS[acc.platform]:{bg:'var(--ink-100)',border:'var(--ink-300)',text:'var(--ink-500)'};
    const d=new Date(post.scheduledAt);
    return(
      <div style={{display:'flex',alignItems:'flex-start',gap:12,padding:'12px 18px',borderBottom:'1px solid var(--ink-100)'}}>
        <div style={{width:8,height:8,borderRadius:'50%',background:color,marginTop:5,flexShrink:0}}/>
        <div style={{width:38,height:38,borderRadius:'var(--r-sm)',background:pc.bg,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0,overflow:'hidden'}}>
          {post.imageUrl?<img src={post.imageUrl} style={{width:'100%',height:'100%',objectFit:'cover'}} alt=""/>:acc?<PlatformIcon platform={acc.platform} size={16} color={pc.text}/>:<div/>}
        </div>
        <div style={{flex:1,minWidth:0}}>
          <div style={{display:'flex',alignItems:'center',gap:6,marginBottom:3,flexWrap:'wrap'}}>
            <span style={{fontSize:11,padding:'2px 8px',borderRadius:'var(--r-pill)',background:color+'22',color:color,fontWeight:600,display:'flex',alignItems:'center',gap:4}}>
              {acc&&<PlatformIcon platform={acc.platform} size={10} color={color}/>}{acc?.handle||'Unknown'}
            </span>
            <span style={{fontSize:11,color:'var(--ink-500)'}}>{post.town}</span>
            <span style={{fontSize:11,color:'var(--ink-400)'}}>{d.toLocaleDateString('en-GB',{day:'numeric',month:'short'})} {d.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'})}</span>
            {acc?.region&&<span style={{fontSize:10,color:'var(--ink-400)'}}>· {acc.region}</span>}
          </div>
          <div style={{fontSize:12,color:'var(--ink-700)',lineHeight:1.5,marginBottom:4}}>{post.caption.slice(0,140)}{post.caption.length>140?'...':''}</div>
        </div>
        <div style={{display:'flex',alignItems:'center',gap:6,flexShrink:0}}>
          <span style={{fontSize:10,padding:'3px 9px',borderRadius:'var(--r-pill)',background:post.status==='scheduled'?'#e8f5ee':post.status==='published'?'#e8f0fb':'var(--ink-100)',color:post.status==='scheduled'?'var(--ok)':post.status==='published'?'var(--info)':'var(--ink-500)',fontWeight:500}}>{post.status}</span>
          <button onClick={()=>setConfirmPublish(post)} title="Publish now" style={{width:28,height:28,borderRadius:'var(--r-xs)',border:'1.5px solid var(--ink-200)',background:'var(--white)',display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer',color:'var(--info)'}}><svg width="12" height="12" viewBox="0 0 24 24" fill="none"><path d="M5 12l5 5L20 7" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/></svg></button><button onClick={()=>openComposer(post)} style={{width:28,height:28,borderRadius:'var(--r-xs)',border:'1.5px solid var(--ink-200)',background:'var(--white)',display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer',color:'var(--ink-500)'}}><Edit3 size={12}/></button>
          <button onClick={()=>saveAndSet(posts.filter(p=>p.id!==post.id))} style={{width:28,height:28,borderRadius:'var(--r-xs)',border:'1.5px solid var(--ink-200)',background:'var(--white)',display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer',color:'var(--alert)'}}><Trash2 size={12}/></button>
        </div>
      </div>
    );
  };

  const selectedAcc=getAccount(form.accountId);
  const platforms=['all','instagram','facebook','linkedin'];
  const pNames:Record<string,string>={all:'All',instagram:'Instagram',facebook:'Facebook',linkedin:'LinkedIn'};

  return(
    <div style={{padding:'24px 28px'}}>
      <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',marginBottom:20}} className="page-header">
        <div>
          <h1 style={{fontFamily:'var(--font-display)',fontSize:28,fontWeight:700,color:'var(--ink-900)',lineHeight:1}}>Social Calendar</h1>
          <p style={{fontSize:12,color:'var(--ink-400)',marginTop:5,fontWeight:500}}>{scheduled.length} scheduled · {drafts.length} drafts · {published.length} published · {accounts.filter(a=>a.active).length} accounts</p>
        </div>
        <div style={{display:'flex',gap:8}} className="btn-row">
          <button style={btnG} onClick={()=>setShowGen(true)}><Sparkles size={13}/> Generate</button>
          <button style={btnP} onClick={()=>openComposer()}><Plus size={13}/> New post</button>
        </div>
      </div>

      <div className="stat-grid" style={{marginBottom:16}}>
        {[{label:'Scheduled',value:scheduled.length,color:'var(--ok)'},{label:'Drafts',value:drafts.length,color:'var(--warn)'},{label:'Published',value:published.length,color:'var(--info)'},{label:'Total',value:posts.length,color:'var(--ink-700)'}].map(s=>(
          <div key={s.label} className="stat-card"><div className="stat-label">{s.label}</div><div className="stat-num" style={{fontSize:28,color:s.color}}>{s.value}</div></div>
        ))}
      </div>

      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:16,flexWrap:'wrap',gap:10}}>
        <div style={{display:'flex',gap:2,background:'var(--ink-100)',borderRadius:'var(--r-md)',padding:3}}>
          {([['calendar','Calendar',<Calendar key="c" size={13}/>],['list','List',<List key="l" size={13}/>]] as [string,string,React.ReactNode][]).map(([id,label,icon])=>(
            <button key={id} onClick={()=>setTab(id as 'calendar'|'list')} style={{display:'flex',alignItems:'center',gap:6,padding:'6px 14px',borderRadius:'var(--r-sm)',background:tab===id?'var(--white)':'transparent',border:'none',cursor:'pointer',fontSize:12,fontWeight:tab===id?600:400,color:tab===id?'var(--ink-900)':'var(--ink-500)',boxShadow:tab===id?'var(--shadow-sm)':'none'}}>{icon}{label}</button>
          ))}
        </div>
        <div style={{display:'flex',gap:6,flexWrap:'wrap',alignItems:'center'}}>
          <select value={platFilter} onChange={e=>{setPlatFilter(e.target.value);setAcctFilter('all');}} style={{...inp,width:'auto',fontSize:11,padding:'4px 10px',cursor:'pointer'}}>
            {platforms.map(p=><option key={p} value={p}>{pNames[p]} platforms</option>)}
          </select>
          <select value={acctFilter} onChange={e=>setAcctFilter(e.target.value)} style={{...inp,width:'auto',fontSize:11,padding:'4px 10px',cursor:'pointer'}}>
            <option value="all">All accounts</option>
            {accounts.filter(a=>platFilter==='all'||a.platform===platFilter).map(a=>(
              <option key={a.id} value={a.id}>{a.handle}</option>
            ))}
          </select>
        </div>
      </div>

      {tab==='calendar'&&(
        <div style={{background:'var(--white)',borderRadius:'var(--r-lg)',boxShadow:'var(--shadow-sm)',overflow:'hidden'}}>
          <div style={{padding:'12px 18px',borderBottom:'1px solid var(--ink-100)',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
            <div style={{fontFamily:'var(--font-display)',fontSize:18,color:'var(--ink-900)'}}>{MONTHS[calM]} {calY}</div>
            <div style={{display:'flex',gap:6}}>
              <button onClick={()=>{if(calM===0){setCalM(11);setCalY(y=>y-1);}else setCalM(m=>m-1);}} style={{...btnG,padding:'5px 10px'}}><ChevronLeft size={14}/></button>
              <button onClick={()=>{setCalM(today.getMonth());setCalY(today.getFullYear());}} style={{...btnG,padding:'5px 10px',fontSize:11}}>Today</button>
              <button onClick={()=>{if(calM===11){setCalM(0);setCalY(y=>y+1);}else setCalM(m=>m+1);}} style={{...btnG,padding:'5px 10px'}}><ChevronRight size={14}/></button>
            </div>
          </div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(7,1fr)',borderBottom:'1px solid var(--ink-100)'}}>
            {['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(d=>(
              <div key={d} style={{padding:8,textAlign:'center',fontSize:10,fontWeight:600,color:'var(--ink-400)',textTransform:'uppercase',letterSpacing:'0.08em'}}>{d}</div>
            ))}
          </div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(7,1fr)'}}>
            {calDays.map((day,i)=>{
              const isToday=day===today.getDate()&&calM===today.getMonth()&&calY===today.getFullYear();
              const dp=day?postsForDay(day):[];
              return(<div key={i} style={{minHeight:88,padding:5,borderRight:i%7!==6?'1px solid var(--ink-100)':'none',borderBottom:i<35?'1px solid var(--ink-100)':'none',background:isToday?'var(--maroon-50)':'var(--white)',cursor:day?'pointer':'default'}} onClick={()=>{if(day){setForm(f=>({...f,scheduledDate:calY+'-'+String(calM+1).padStart(2,'0')+'-'+String(day).padStart(2,'0')}));openComposer();}}}>
                {day&&(<>
                  <div style={{fontSize:11,fontWeight:isToday?700:400,color:isToday?'var(--maroon-700)':'var(--ink-400)',marginBottom:3}}>{day}{isToday&&<span style={{marginLeft:4,fontSize:9,background:'var(--maroon-700)',color:'white',padding:'1px 5px',borderRadius:'var(--r-pill)'}}>today</span>}</div>
                  {dp.slice(0,3).map(p=><PostPill key={p.id} post={p}/>)}
                  {dp.length>3&&<div style={{fontSize:9,color:'var(--ink-400)'}}>+{dp.length-3}</div>}
                </>)}
              </div>);
            })}
          </div>
        </div>
      )}

      {tab==='list'&&(
        <div style={{background:'var(--white)',borderRadius:'var(--r-lg)',boxShadow:'var(--shadow-sm)',overflow:'hidden'}}>
          {filtered.length===0?(
            <div style={{padding:48,textAlign:'center'}}>
              <Calendar size={32} color="var(--ink-200)" style={{margin:'0 auto 12px',display:'block'}}/>
              <div style={{fontFamily:'var(--font-display)',fontSize:18,color:'var(--ink-700)',marginBottom:8}}>No posts yet</div>
              <div style={{fontSize:12,color:'var(--ink-400)',marginBottom:16}}>Create your first post or generate with AI</div>
              <button style={btnP} onClick={()=>setShowGen(true)}><Sparkles size={13}/> Generate with AI</button>
            </div>
          ):(<>
            {scheduled.length>0&&(<><div style={{padding:'9px 18px',background:'#e8f5ee',borderBottom:'1px solid var(--ink-100)',fontSize:11,fontWeight:600,color:'var(--ok)',textTransform:'uppercase',letterSpacing:'0.08em',display:'flex',alignItems:'center',gap:6}}><Clock size={12}/>Scheduled ({scheduled.length})</div>{scheduled.sort((a,b)=>new Date(a.scheduledAt).getTime()-new Date(b.scheduledAt).getTime()).map(p=><PostRow key={p.id} post={p}/>)}</>)}
            {drafts.length>0&&(<><div style={{padding:'9px 18px',background:'var(--paper)',borderBottom:'1px solid var(--ink-100)',fontSize:11,fontWeight:600,color:'var(--warn)',textTransform:'uppercase',letterSpacing:'0.08em',display:'flex',alignItems:'center',gap:6}}><Edit3 size={12}/>Drafts ({drafts.length})</div>{drafts.map(p=><PostRow key={p.id} post={p}/>)}</>)}
            {published.length>0&&(<><div style={{padding:'9px 18px',background:'var(--paper)',borderBottom:'1px solid var(--ink-100)',fontSize:11,fontWeight:600,color:'var(--info)',textTransform:'uppercase',letterSpacing:'0.08em',display:'flex',alignItems:'center',gap:6}}><Check size={12}/>Published ({published.length})</div>{published.map(p=><PostRow key={p.id} post={p}/>)}</>)}
          
      {confirmPublish && (
        <div style={{position:'fixed',inset:0,background:'rgba(26,13,18,0.5)',zIndex:600,display:'flex',alignItems:'center',justifyContent:'center',padding:16}} onClick={e=>{if(e.target===e.currentTarget&&!publishing)setConfirmPublish(null);}}>
          <div style={{background:'var(--white)',borderRadius:'var(--r-lg)',width:'min(480px,100%)',padding:24,boxShadow:'var(--shadow-lg)'}}>
            <h2 style={{fontSize:20,fontWeight:700,marginBottom:8}}>Publish post?</h2>
            <p style={{fontSize:13,color:'var(--ink-500)',marginBottom:16}}>This will post to {confirmPublish.accountIds.length} account{confirmPublish.accountIds.length===1?'':'s'} immediately.</p>
            <div style={{display:'flex',flexDirection:'column',gap:8,marginBottom:20,maxHeight:240,overflowY:'auto'}}>
              {accounts.filter(a=>confirmPublish.accountIds.includes(a.id)).sort((a,b)=>{
                const o:Record<string,number>={linkedin:0,facebook:1,instagram:2,x:3};
                return (o[a.platform]||9)-(o[b.platform]||9);
              }).map(a=>{
                const r=confirmPublish.results?.[a.id];
                return (
                  <div key={a.id} style={{display:'flex',alignItems:'center',gap:10,padding:'10px 12px',borderRadius:'var(--r-md)',background:'var(--paper)',border:`1px solid ${a.color}33`}}>
                    <div style={{width:24,height:24,borderRadius:'50%',background:a.color,display:'flex',alignItems:'center',justifyContent:'center',color:'#fff',flexShrink:0}}>
                      <PlatformIcon platform={a.platform} size={12} color="#fff"/>
                    </div>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:13,fontWeight:600}}>{a.handle}</div>
                      <div style={{fontSize:10,color:'var(--ink-400)',textTransform:'capitalize'}}>{a.platform}</div>
                    </div>
                    {r?.status==='published'&&<Check size={16} color="var(--ok)"/>}
                    {r?.status==='publishing'&&<div style={{fontSize:11,color:'var(--info)'}}>Posting…</div>}
                    {r?.status==='failed'&&<div style={{fontSize:11,color:'var(--alert)'}} title={r.error}>Failed</div>}
                    {!r&&<div style={{fontSize:11,color:'var(--ink-400)'}}>Pending</div>}
                  </div>
                );
              })}
            </div>
            <p style={{fontSize:11,color:'var(--ink-400)',marginBottom:16}}>Posts are sent in order: LinkedIn → Facebook → Instagram.</p>
            <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
              <button onClick={()=>{if(!publishing)setConfirmPublish(null);}} disabled={!!publishing} style={btnG}>Cancel</button>
              <button onClick={()=>publishPost(confirmPublish)} disabled={!!publishing} style={{...btnP,opacity:publishing?0.6:1}}>
                {publishing?'Publishing…':'Confirm & publish'}
              </button>
            </div>
          </div>
        </div>
      )}
</>)}
        </div>
      )}

      {showComposer&&(
        <div style={{position:'fixed',inset:0,background:'rgba(26,13,18,0.5)',zIndex:500,display:'flex',alignItems:'center',justifyContent:'center',padding:16}} onClick={e=>{if(e.target===e.currentTarget)setShowComposer(false);}}>
          <div style={{background:'var(--white)',borderRadius:'var(--r-xl)',width:580,maxWidth:'100%',maxHeight:'90vh',overflowY:'auto',boxShadow:'var(--shadow-lg)'}}>
            <div style={{padding:'18px 22px 14px',borderBottom:'1px solid var(--ink-100)',display:'flex',justifyContent:'space-between',alignItems:'center',position:'sticky',top:0,background:'var(--white)',zIndex:1}}>
              <div style={{fontFamily:'var(--font-display)',fontSize:20,color:'var(--ink-900)'}}>{editPost?'Edit post':'New post'}</div>
              <button onClick={()=>setShowComposer(false)} style={{...btnG,padding:'4px 8px'}}><X size={14}/></button>
            </div>
            <div style={{padding:'18px 22px',display:'flex',flexDirection:'column',gap:14}}>

              {/* Account picker */}
              <div>
                <label style={{display:'block',fontSize:11,fontWeight:600,color:'var(--ink-600)',marginBottom:8,textTransform:'uppercase',letterSpacing:'0.06em'}}>Account</label>
                <div style={{display:'flex',flexDirection:'column',gap:6}}>
                  {accounts.filter(a=>a.active).map(a=>{
                  const selected=form.accountIds?.includes(a.id);
                  return (
                    <button key={a.id} type="button" onClick={()=>{
                      const ids=form.accountIds||[];
                      setForm({...form,accountIds:selected?ids.filter(x=>x!==a.id):[...ids,a.id]});
                    }} style={{display:'flex',alignItems:'center',gap:10,padding:'10px 12px',borderRadius:'var(--r-md)',border:`1.5px solid ${selected?a.color:'var(--ink-200)'}`,background:selected?a.color+'15':'var(--white)',cursor:'pointer',textAlign:'left',fontFamily:'inherit',position:'relative'}}>
                      <div style={{width:24,height:24,borderRadius:'50%',background:a.color,display:'flex',alignItems:'center',justifyContent:'center',color:'#fff',flexShrink:0}}>
                        <PlatformIcon platform={a.platform} size={12} color="#fff"/>
                      </div>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{fontSize:12,fontWeight:600,color:selected?a.color:'var(--ink-900)',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{a.handle}</div>
                        <div style={{fontSize:10,color:'var(--ink-400)',textTransform:'capitalize'}}>{a.platform}{a.region?` · ${a.region}`:''}</div>
                      </div>
                      {selected && <div style={{width:18,height:18,borderRadius:'50%',background:a.color,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}><Check size={11} color="#fff"/></div>}
                    </button>
                  );
                })}
                </div>
                {selectedAcc&&<div style={{marginTop:8,padding:'8px 12px',background:'var(--paper)',borderRadius:'var(--r-sm)',fontSize:11,color:'var(--ink-500)',lineHeight:1.5}}><strong style={{color:'var(--ink-700)'}}>Tone:</strong> {selectedAcc.tone}</div>}
              </div>

              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
                <div>
                  <label style={{display:'block',fontSize:11,fontWeight:600,color:'var(--ink-600)',marginBottom:5,textTransform:'uppercase',letterSpacing:'0.06em'}}>Town</label>
                  <input value={form.town} onChange={e=>setForm({...form,town:e.target.value})} placeholder="e.g. Whitstable" style={inp} list="tl"/><datalist id="tl">{TOWNS.map(t=><option key={t} value={t}/>)}</datalist>
                </div>
                <div>
                  <label style={{display:'block',fontSize:11,fontWeight:600,color:'var(--ink-600)',marginBottom:5,textTransform:'uppercase',letterSpacing:'0.06em'}}>Status</label>
                  <select value={form.status} onChange={e=>setForm({...form,status:e.target.value as SocialPost['status']})} style={{...inp,cursor:'pointer'}}>
                    <option value="draft">Draft</option><option value="scheduled">Scheduled</option>
                  </select>
                </div>
              </div>

              <div>
                <label style={{display:'block',fontSize:11,fontWeight:600,color:'var(--ink-600)',marginBottom:5,textTransform:'uppercase',letterSpacing:'0.06em'}}>Caption</label>
                <textarea value={form.caption} onChange={e=>setForm({...form,caption:e.target.value})} placeholder="Write your post caption..." rows={4} style={{...inp,resize:'vertical'}}/>
                <div style={{fontSize:10,color:'var(--ink-400)',marginTop:3,textAlign:'right'}}>{form.caption.length} chars</div>
              </div>

              <div>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
                  <label style={{fontSize:11,fontWeight:600,color:'var(--ink-600)',textTransform:'uppercase',letterSpacing:'0.06em'}}>Image</label>
                  <button onClick={searchUnsplash} disabled={searchingImgs} style={{...btnG,fontSize:11,padding:'4px 10px',gap:5}}><Image size={11}/>{searchingImgs?'Searching...':'Search Unsplash'}</button>
                </div>
                {form.imageUrl&&(<div style={{marginBottom:8,position:'relative'}}>
                  <img src={form.imageUrl} style={{width:'100%',height:140,objectFit:'cover',borderRadius:'var(--r-md)',border:'1px solid var(--ink-100)',display:'block'}} alt=""/>
                  <button onClick={()=>setForm({...form,imageUrl:'',imageCredit:''})} style={{position:'absolute',top:6,right:6,width:22,height:22,borderRadius:'50%',background:'rgba(0,0,0,0.5)',border:'none',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',color:'white'}}><X size={11}/></button>
                  {form.imageCredit&&<div style={{fontSize:10,color:'var(--ink-400)',marginTop:3}}>Photo by {form.imageCredit} on Unsplash</div>}
                </div>)}
                {unsplash.length>0&&(<div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:6,marginBottom:8}}>
                  {unsplash.map((img,i)=>(
                    <div key={i} onClick={()=>{setForm({...form,imageUrl:img.url,imageCredit:img.credit});setUnsplash([]);}} style={{cursor:'pointer',borderRadius:'var(--r-sm)',overflow:'hidden',border:'2px solid '+(form.imageUrl===img.url?'var(--maroon-700)':'transparent'),position:'relative'}}>
                      <img src={img.thumb} style={{width:'100%',height:65,objectFit:'cover',display:'block'}} alt=""/>
                      <div style={{position:'absolute',bottom:0,left:0,right:0,padding:'2px 5px',background:'rgba(0,0,0,0.5)',fontSize:9,color:'white',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{img.credit}</div>
                    </div>
                  ))}
                </div>)}
                {!form.imageUrl&&unsplash.length===0&&(<div style={{background:'var(--paper)',borderRadius:'var(--r-md)',padding:16,textAlign:'center',border:'1.5px dashed var(--ink-200)'}}>
                  <Image size={18} color="var(--ink-300)" style={{margin:'0 auto 6px',display:'block'}}/>
                  <div style={{fontSize:11,color:'var(--ink-400)',marginBottom:8}}>Search Unsplash or paste URL</div>
                  <input value={form.imageUrl} onChange={e=>setForm({...form,imageUrl:e.target.value})} placeholder="Paste image URL..." style={{...inp,fontSize:11}}/>
                </div>)}
              </div>

              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
                <div><label style={{display:'block',fontSize:11,fontWeight:600,color:'var(--ink-600)',marginBottom:5,textTransform:'uppercase',letterSpacing:'0.06em'}}>Date</label><input type="date" value={form.scheduledDate} onChange={e=>setForm({...form,scheduledDate:e.target.value})} style={inp}/></div>
                <div><label style={{display:'block',fontSize:11,fontWeight:600,color:'var(--ink-600)',marginBottom:5,textTransform:'uppercase',letterSpacing:'0.06em'}}>Time</label><input type="time" value={form.scheduledTime} onChange={e=>setForm({...form,scheduledTime:e.target.value})} style={inp}/></div>
              </div>
            </div>
            <div style={{padding:'14px 22px',borderTop:'1px solid var(--ink-100)',display:'flex',gap:8,justifyContent:'flex-end',position:'sticky',bottom:0,background:'var(--white)'}}>
              <button onClick={()=>setShowComposer(false)} style={btnG}>Cancel</button>
              <button type="button" onClick={()=>{
                if(!form.accountIds?.length||!form.caption.trim()) return;
                // Build a temp post object, save first if not yet saved, then trigger confirm
                if(editPost){
                  setConfirmPublish({...editPost,...form,scheduledAt:new Date(form.scheduledDate+'T'+form.scheduledTime).toISOString()} as SocialPost);
                }else{
                  const np:SocialPost={id:'p'+Date.now(),accountIds:form.accountIds,town:form.town,caption:form.caption,imageUrl:form.imageUrl,imageCredit:form.imageCredit,scheduledAt:new Date(form.scheduledDate+'T'+form.scheduledTime).toISOString(),status:'draft',createdAt:new Date().toISOString()};
                  saveAndSet([np,...posts]);
                  setShowComposer(false);
                  setConfirmPublish(np);
                }
              }} disabled={!form.caption.trim()||!form.accountIds?.length} style={{...btnP,background:'#0A66C2',opacity:(!form.caption.trim()||!form.accountIds?.length)?0.5:1,marginRight:8}}>Publish Now</button><button onClick={savePost} disabled={!form.caption.trim()||!form.accountIds?.length} style={{...btnP,opacity:!form.caption.trim()?0.5:1}}><Check size={13}/>{editPost?'Save changes':'Create post'}</button>
            </div>
          </div>
        </div>
      )}

      {showGen&&(
        <div style={{position:'fixed',inset:0,background:'rgba(26,13,18,0.5)',zIndex:500,display:'flex',alignItems:'center',justifyContent:'center',padding:16}} onClick={e=>{if(e.target===e.currentTarget)setShowGen(false);}}>
          <div style={{background:'var(--white)',borderRadius:'var(--r-xl)',width:500,maxWidth:'100%',maxHeight:'90vh',overflowY:'auto',boxShadow:'var(--shadow-lg)'}}>
            <div style={{padding:'18px 22px 14px',borderBottom:'1px solid var(--ink-100)',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
              <div style={{display:'flex',alignItems:'center',gap:8}}><Sparkles size={16} color="var(--maroon-600)"/><div style={{fontFamily:'var(--font-display)',fontSize:20,color:'var(--ink-900)'}}>Generate with AI</div></div>
              <button onClick={()=>setShowGen(false)} style={{...btnG,padding:'4px 8px'}}><X size={14}/></button>
            </div>
            <div style={{padding:'18px 22px',display:'flex',flexDirection:'column',gap:14}}>
              <div>
                <label style={{display:'block',fontSize:11,fontWeight:600,color:'var(--ink-600)',marginBottom:5,textTransform:'uppercase',letterSpacing:'0.06em'}}>Town</label>
                <input value={genForm.town} onChange={e=>setGenForm({...genForm,town:e.target.value})} placeholder="e.g. Whitstable" style={inp} list="gtl"/>
                <datalist id="gtl">{TOWNS.map(t=><option key={t} value={t}/>)}</datalist>
              </div>
              <div>
                <label style={{display:'block',fontSize:11,fontWeight:600,color:'var(--ink-600)',marginBottom:8,textTransform:'uppercase',letterSpacing:'0.06em'}}>Generate for accounts</label>
                <div style={{display:'flex',flexDirection:'column',gap:6}}>
                  {accounts.filter(a=>a.active).map(a=>{
                    const pc=PLATFORM_COLORS[a.platform];
                    const checked=genForm.accountIds.includes(a.id);
                    return(
                      <label key={a.id} style={{display:'flex',alignItems:'center',gap:10,cursor:'pointer',padding:'10px 12px',borderRadius:'var(--r-md)',border:`1.5px solid ${checked?a.color:'var(--ink-200)'}`,background:checked?a.color+'12':'var(--white)'}}>
                        <input type="checkbox" checked={checked} onChange={e=>setGenForm({...genForm,accountIds:e.target.checked?[...genForm.accountIds,a.id]:genForm.accountIds.filter(id=>id!==a.id)})} style={{accentColor:a.color,width:14,height:14}}/>
                        <div style={{width:24,height:24,borderRadius:'50%',background:pc.bg,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}><PlatformIcon platform={a.platform} size={12} color={pc.text}/></div>
                        <div style={{flex:1,minWidth:0}}>
                          <div style={{fontSize:12,fontWeight:600,color:checked?a.color:'var(--ink-900)'}}>{a.handle}</div>
                          <div style={{fontSize:10,color:'var(--ink-400)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{a.tone.slice(0,50)}</div>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
                <div>
                  <label style={{display:'block',fontSize:11,fontWeight:600,color:'var(--ink-600)',marginBottom:5,textTransform:'uppercase',letterSpacing:'0.06em'}}>Posts per account</label>
                  <select value={genForm.postsPerAccount} onChange={e=>setGenForm({...genForm,postsPerAccount:Number(e.target.value)})} style={{...inp,cursor:'pointer'}}>
                    <option value={2}>2 posts</option><option value={3}>3 posts</option><option value={5}>5 posts</option>
                  </select>
                </div>
                <div>
                  <label style={{display:'block',fontSize:11,fontWeight:600,color:'var(--ink-600)',marginBottom:5,textTransform:'uppercase',letterSpacing:'0.06em'}}>Week starting</label>
                  <input type="date" value={genForm.weekStart} onChange={e=>setGenForm({...genForm,weekStart:e.target.value})} style={inp}/>
                </div>
              </div>
              <div style={{background:'var(--maroon-50)',borderRadius:'var(--r-md)',padding:'10px 12px',fontSize:11,color:'var(--maroon-700)',lineHeight:1.5}}>
                Roam-io will write in each account's specific voice using their strategy brief. All posts start as drafts.
              </div>
            </div>
            <div style={{padding:'14px 22px',borderTop:'1px solid var(--ink-100)',display:'flex',gap:8,justifyContent:'flex-end'}}>
              <button onClick={()=>setShowGen(false)} style={btnG}>Cancel</button>
              <button onClick={generate} disabled={generating||!genForm.town.trim()||!genForm.accountIds.length} style={{...btnP,opacity:generating||!genForm.town.trim()||!genForm.accountIds.length?0.6:1}}>
                <Sparkles size={13}/>{generating?'Generating...':'Generate for '+genForm.accountIds.length+' account'+(genForm.accountIds.length===1?'':'s')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
