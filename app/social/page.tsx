'use client';
import {useState,useEffect} from 'react';
import {Plus,Calendar,List,Briefcase,MessageCircle,X,Image,Sparkles,ChevronLeft,ChevronRight,Check,Clock,Edit3,Trash2,Camera} from 'lucide-react';
import {addNotification} from '@/components/NotificationCentre';

interface SocialPost{id:string;channel:'instagram'|'facebook'|'linkedin';strategy:string;town:string;caption:string;imageUrl?:string;imageCredit?:string;scheduledAt:string;status:'draft'|'scheduled'|'published'|'failed';createdAt:string;}
interface Strategy{id:string;channel:'instagram'|'facebook'|'linkedin';name:string;persona:string;tone:string;contentType:string;}

const DEFAULT_STRATEGIES:Strategy[]=[
  {id:'ig1',channel:'instagram',name:'Local Explorer',persona:'Warm, visual discovery',tone:'Warm, inspiring, community-first',contentType:'Town features, food photos, hidden gems'},
  {id:'ig2',channel:'instagram',name:'Business Spotlight',persona:'Celebrating independents',tone:'Celebratory, personal, story-driven',contentType:'Business owner stories, behind the scenes'},
  {id:'fb1',channel:'facebook',name:'Community Voice',persona:'Friendly, community-focused',tone:'Conversational, inclusive, local pride',contentType:'Events, local news, community stories'},
  {id:'li1',channel:'linkedin',name:'Business Connector',persona:'Professional growth narrative',tone:'Professional, growth-focused, insightful',contentType:'Business spotlights, founder stories, stats'},
  {id:'li2',channel:'linkedin',name:'Town Economy',persona:'Economic and business focus',tone:'Data-driven, authoritative, forward-looking',contentType:'Economic insights, business growth, market data'},
];

const CC:Record<string,{bg:string;border:string;text:string;pill:string}>={
  instagram:{bg:'#fbeaef',border:'#9b2752',text:'#6B1230',pill:'#f4d8df'},
  facebook:{bg:'#dde9f7',border:'#3b5998',text:'#1a3a6b',pill:'#c8dcf5'},
  linkedin:{bg:'#e8f0fb',border:'#185FA5',text:'#0C447C',pill:'#b5d4f4'},
};
const CN:Record<string,string>={instagram:'Instagram',facebook:'Facebook',linkedin:'LinkedIn'};
const CI:Record<string,React.ReactNode>={instagram:<Camera size={12}/>,facebook:<MessageCircle size={12}/>,linkedin:<Briefcase size={12}/>};
const TOWNS=['Whitstable','Darlington','Aberfeldy','London','Edinburgh','Bristol','Manchester','Leeds'];
const MONTHS=['January','February','March','April','May','June','July','August','September','October','November','December'];

function getPosts():SocialPost[]{try{return JSON.parse(localStorage.getItem('roam_social_posts')||'[]');}catch{return[];}}
function savePosts(p:SocialPost[]){try{localStorage.setItem('roam_social_posts',JSON.stringify(p));}catch{}}
function getStrats():Strategy[]{try{const s=localStorage.getItem('roam_strategies');return s?JSON.parse(s):DEFAULT_STRATEGIES;}catch{return DEFAULT_STRATEGIES;}}
function getDays(y:number,m:number):number{return new Date(y,m+1,0).getDate();}
function getFirst(y:number,m:number):number{const d=new Date(y,m,1).getDay();return d===0?6:d-1;}

export default function SocialPage(){
  const [tab,setTab]=useState<'calendar'|'list'>('calendar');
  const [posts,setPosts]=useState<SocialPost[]>([]);
  const [strategies]=useState<Strategy[]>(getStrats());
  const [chFilter,setChFilter]=useState('all');
  const [showComposer,setShowComposer]=useState(false);
  const [showGen,setShowGen]=useState(false);
  const [showStrats,setShowStrats]=useState(false);
  const [editPost,setEditPost]=useState<SocialPost|null>(null);
  const [generating,setGenerating]=useState(false);
  const [searchingImgs,setSearchingImgs]=useState(false);
  const [unsplash,setUnsplash]=useState<{url:string;thumb:string;credit:string}[]>([]);
  const today=new Date();
  const [calY,setCalY]=useState(today.getFullYear());
  const [calM,setCalM]=useState(today.getMonth());

  const blankForm={channel:'instagram' as SocialPost['channel'],strategy:'ig1',town:'Whitstable',caption:'',imageUrl:'',imageCredit:'',scheduledDate:today.toISOString().split('T')[0],scheduledTime:'10:00',status:'draft' as SocialPost['status']};
  const [form,setForm]=useState(blankForm);
  const [genForm,setGenForm]=useState({town:'Whitstable',channels:{instagram:true,facebook:true,linkedin:true},postsPerChannel:3,weekStart:today.toISOString().split('T')[0]});

  useEffect(()=>{setPosts(getPosts());},[]);
  function saveAndSet(p:SocialPost[]){setPosts(p);savePosts(p);}

  function openComposer(post?:SocialPost){
    if(post){
      setEditPost(post);
      const dt=new Date(post.scheduledAt);
      setForm({channel:post.channel,strategy:post.strategy,town:post.town,caption:post.caption,imageUrl:post.imageUrl||'',imageCredit:post.imageCredit||'',scheduledDate:dt.toISOString().split('T')[0],scheduledTime:dt.toTimeString().slice(0,5),status:post.status});
    }else{setEditPost(null);setForm(blankForm);}
    setUnsplash([]);setShowComposer(true);
  }

  function savePost(){
    if(!form.caption.trim())return;
    const scheduledAt=new Date(form.scheduledDate+'T'+form.scheduledTime).toISOString();
    if(editPost){saveAndSet(posts.map(p=>p.id===editPost.id?{...p,...form,scheduledAt}:p));}
    else{
      const np:SocialPost={id:Date.now().toString(),...form,scheduledAt,createdAt:new Date().toISOString()};
      saveAndSet([np,...posts]);
      addNotification({type:'info',title:'Post created',body:CN[form.channel]+' post scheduled for '+form.scheduledDate});
    }
    setShowComposer(false);
  }

  async function searchUnsplash(){
    setSearchingImgs(true);setUnsplash([]);
    try{const res=await fetch('/api/images/search?query='+encodeURIComponent(form.town+' town')+'&count=6');const d=await res.json();setUnsplash(d.images||[]);}catch{}
    setSearchingImgs(false);
  }

  async function generate(){
    setGenerating(true);
    const chs=Object.entries(genForm.channels).filter(([,v])=>v).map(([k])=>k);
    try{
      const res=await fetch('/api/ai/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
        maxTokens:2000,
        systemPrompt:'You are a social media content generator for Roam Local. Return ONLY a valid JSON array. No markdown, no code blocks, no explanation. Start your response with [ and end with ].',
        messages:[{role:'user',content:`Generate exactly ${genForm.postsPerChannel} posts for EACH of these channels: ${chs.join(', ')}. Total posts = ${genForm.postsPerChannel * chs.length}. Town: ${genForm.town}, UK.

Return ONLY a JSON array. Each item must have: channel, caption, scheduledDay (1-7).

Rules:
- instagram posts: warm, visual, end with 3-5 hashtags
- linkedin posts: professional, business-focused, no hashtags  
- facebook posts: friendly, community feel

Example: [{"channel":"instagram","caption":"Discover ${genForm.town}... #HashTag","scheduledDay":1},{"channel":"linkedin","caption":"${genForm.town} is growing...","scheduledDay":2},{"channel":"facebook","caption":"Love ${genForm.town}!","scheduledDay":3}]

Generate ${genForm.postsPerChannel} posts per channel now:`}],
      })});
      const d=await res.json();
      // Parse AI response directly
      let raw = d.content || '[]';
      raw = raw.replace(/```json/g,'').replace(/```/g,'').trim();
      const gen=JSON.parse(raw);
      const start=new Date(genForm.weekStart);
      const newPosts:SocialPost[]=gen.map((g:Record<string,unknown>,i:number)=>{
        const dt=new Date(start);
        const dayOffset=typeof g.scheduledDay==='number'?g.scheduledDay:i;
        dt.setDate(dt.getDate()+dayOffset);dt.setHours(10,0,0,0);
        const ch=((g.channel as string)||'instagram') as SocialPost['channel'];
        const caption=(g.caption||g.text||g.content||g.post||'') as string;
        return{id:(Date.now()+i).toString(),channel:ch,strategy:strategies.find(s=>s.channel===ch)?.id||'ig1',town:genForm.town,caption,scheduledAt:dt.toISOString(),status:'draft' as const,createdAt:new Date().toISOString(),imageUrl:'',imageCredit:''};
      });
      saveAndSet([...newPosts,...posts]);
      addNotification({type:'info',title:'Content generated',body:newPosts.length+' posts created for '+genForm.town});
      setShowGen(false);
    }catch(e){console.error(e);}
    setGenerating(false);
  }

  const filtered=posts.filter(p=>chFilter==='all'||p.channel===chFilter);
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

  const PostPill=({post}:{post:SocialPost})=>{const c=CC[post.channel];return(
    <div onClick={()=>openComposer(post)} style={{background:c.pill,borderLeft:'2px solid '+c.border,borderRadius:3,padding:'2px 5px',marginBottom:2,cursor:'pointer',overflow:'hidden'}}>
      <div style={{display:'flex',alignItems:'center',gap:3}}><span style={{color:c.text,display:'flex'}}>{CI[post.channel]}</span><span style={{fontSize:9,color:c.text,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',maxWidth:70,opacity:post.status==='draft'?0.6:1}}>{post.town}</span></div>
    </div>);};

  const PostRow=({post}:{post:SocialPost})=>{const c=CC[post.channel];const d=new Date(post.scheduledAt);return(
    <div style={{display:'flex',alignItems:'flex-start',gap:12,padding:'12px 18px',borderBottom:'1px solid var(--ink-100)'}}>
      <div style={{width:8,height:8,borderRadius:'50%',background:c.border,marginTop:5,flexShrink:0}}/>
      <div style={{width:38,height:38,borderRadius:'var(--r-sm)',background:c.bg,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0,overflow:'hidden'}}>
        {post.imageUrl?<img src={post.imageUrl} style={{width:'100%',height:'100%',objectFit:'cover'}} alt=""/>:<span style={{color:c.text}}>{CI[post.channel]}</span>}
      </div>
      <div style={{flex:1,minWidth:0}}>
        <div style={{display:'flex',alignItems:'center',gap:6,marginBottom:3,flexWrap:'wrap'}}>
          <span style={{fontSize:11,padding:'2px 8px',borderRadius:'var(--r-pill)',background:c.pill,color:c.text,fontWeight:500,display:'flex',alignItems:'center',gap:4}}>{CI[post.channel]}{CN[post.channel]}</span>
          <span style={{fontSize:11,color:'var(--ink-500)'}}>{post.town}</span>
          <span style={{fontSize:11,color:'var(--ink-400)'}}>{d.toLocaleDateString('en-GB',{day:'numeric',month:'short'})} {d.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'})}</span>
        </div>
        <div style={{fontSize:12,color:'var(--ink-700)',lineHeight:1.5,marginBottom:4}}>{post.caption.slice(0,120)}{post.caption.length>120?'...':''}</div>
        <div style={{fontSize:11,color:'var(--ink-400)'}}>{strategies.find(s=>s.id===post.strategy)?.name}</div>
      </div>
      <div style={{display:'flex',alignItems:'center',gap:6,flexShrink:0}}>
        <span style={{fontSize:10,padding:'3px 9px',borderRadius:'var(--r-pill)',background:post.status==='scheduled'?'#e8f5ee':post.status==='published'?'#e8f0fb':'var(--ink-100)',color:post.status==='scheduled'?'var(--ok)':post.status==='published'?'var(--info)':'var(--ink-500)',fontWeight:500}}>{post.status}</span>
        <button onClick={()=>openComposer(post)} style={{width:28,height:28,borderRadius:'var(--r-xs)',border:'1.5px solid var(--ink-200)',background:'var(--white)',display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer',color:'var(--ink-500)'}}><Edit3 size={12}/></button>
        <button onClick={()=>saveAndSet(posts.filter(p=>p.id!==post.id))} style={{width:28,height:28,borderRadius:'var(--r-xs)',border:'1.5px solid var(--ink-200)',background:'var(--white)',display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer',color:'var(--alert)'}}><Trash2 size={12}/></button>
      </div>
    </div>);};

  return(
    <div style={{padding:'24px 28px'}}>
      <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',marginBottom:20}} className="page-header">
        <div>
          <h1 style={{fontFamily:'var(--font-display)',fontSize:28,fontWeight:700,color:'var(--ink-900)',lineHeight:1}}>Social Calendar</h1>
          <p style={{fontSize:12,color:'var(--ink-400)',marginTop:5,fontWeight:500}}>{scheduled.length} scheduled · {drafts.length} drafts · {published.length} published</p>
        </div>
        <div style={{display:'flex',gap:8}} className="btn-row">
          <button style={btnG} onClick={()=>setShowStrats(true)}><Sparkles size={13}/> Strategies</button>
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
        <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
          {(['all','instagram','facebook','linkedin'] as const).map(ch=>{const c=ch==='all'?null:CC[ch];return(
            <button key={ch} onClick={()=>setChFilter(ch)} style={{fontSize:11,padding:'4px 12px',borderRadius:'var(--r-pill)',border:'1.5px solid '+(chFilter===ch?(c?c.border:'var(--maroon-700)'):'var(--ink-200)'),background:chFilter===ch?(c?c.pill:'var(--maroon-50)'):'var(--white)',color:chFilter===ch?(c?c.text:'var(--maroon-700)'):'var(--ink-500)',cursor:'pointer',fontWeight:chFilter===ch?600:400,display:'flex',alignItems:'center',gap:5}}>
              {ch!=='all'&&<span style={{color:c?.text}}>{CI[ch]}</span>}{ch==='all'?'All':CN[ch]}
            </button>);})}
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
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
                <div><label style={{display:'block',fontSize:11,fontWeight:600,color:'var(--ink-600)',marginBottom:5,textTransform:'uppercase',letterSpacing:'0.06em'}}>Channel</label>
                <select value={form.channel} onChange={e=>setForm({...form,channel:e.target.value as SocialPost['channel'],strategy:strategies.find(s=>s.channel===e.target.value)?.id||'ig1'})} style={{...inp,cursor:'pointer'}}>
                  <option value="instagram">Instagram</option><option value="facebook">Facebook</option><option value="linkedin">LinkedIn</option>
                </select></div>
                <div><label style={{display:'block',fontSize:11,fontWeight:600,color:'var(--ink-600)',marginBottom:5,textTransform:'uppercase',letterSpacing:'0.06em'}}>Strategy</label>
                <select value={form.strategy} onChange={e=>setForm({...form,strategy:e.target.value})} style={{...inp,cursor:'pointer'}}>
                  {strategies.filter(s=>s.channel===form.channel).map(s=><option key={s.id} value={s.id}>{s.name}</option>)}
                </select></div>
              </div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
                <div><label style={{display:'block',fontSize:11,fontWeight:600,color:'var(--ink-600)',marginBottom:5,textTransform:'uppercase',letterSpacing:'0.06em'}}>Town</label>
                <input value={form.town} onChange={e=>setForm({...form,town:e.target.value})} placeholder="e.g. Whitstable" style={inp} list="tl"/><datalist id="tl">{TOWNS.map(t=><option key={t} value={t}/>)}</datalist></div>
                <div><label style={{display:'block',fontSize:11,fontWeight:600,color:'var(--ink-600)',marginBottom:5,textTransform:'uppercase',letterSpacing:'0.06em'}}>Status</label>
                <select value={form.status} onChange={e=>setForm({...form,status:e.target.value as SocialPost['status']})} style={{...inp,cursor:'pointer'}}>
                  <option value="draft">Draft</option><option value="scheduled">Scheduled</option>
                </select></div>
              </div>
              <div><label style={{display:'block',fontSize:11,fontWeight:600,color:'var(--ink-600)',marginBottom:5,textTransform:'uppercase',letterSpacing:'0.06em'}}>Caption</label>
              <textarea value={form.caption} onChange={e=>setForm({...form,caption:e.target.value})} placeholder="Write your post caption..." rows={4} style={{...inp,resize:'vertical'}}/>
              <div style={{fontSize:10,color:'var(--ink-400)',marginTop:3,textAlign:'right'}}>{form.caption.length} chars</div></div>
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
                  <div style={{fontSize:11,color:'var(--ink-400)',marginBottom:8}}>Search Unsplash for free images or paste URL</div>
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
              <button onClick={savePost} disabled={!form.caption.trim()} style={{...btnP,opacity:!form.caption.trim()?0.5:1}}><Check size={13}/>{editPost?'Save changes':'Create post'}</button>
            </div>
          </div>
        </div>
      )}

      {showGen&&(
        <div style={{position:'fixed',inset:0,background:'rgba(26,13,18,0.5)',zIndex:500,display:'flex',alignItems:'center',justifyContent:'center',padding:16}} onClick={e=>{if(e.target===e.currentTarget)setShowGen(false);}}>
          <div style={{background:'var(--white)',borderRadius:'var(--r-xl)',width:460,maxWidth:'100%',boxShadow:'var(--shadow-lg)'}}>
            <div style={{padding:'18px 22px 14px',borderBottom:'1px solid var(--ink-100)',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
              <div style={{display:'flex',alignItems:'center',gap:8}}><Sparkles size={16} color="var(--maroon-600)"/><div style={{fontFamily:'var(--font-display)',fontSize:20,color:'var(--ink-900)'}}>Generate with AI</div></div>
              <button onClick={()=>setShowGen(false)} style={{...btnG,padding:'4px 8px'}}><X size={14}/></button>
            </div>
            <div style={{padding:'18px 22px',display:'flex',flexDirection:'column',gap:14}}>
              <div><label style={{display:'block',fontSize:11,fontWeight:600,color:'var(--ink-600)',marginBottom:5,textTransform:'uppercase',letterSpacing:'0.06em'}}>Town</label>
              <input value={genForm.town} onChange={e=>setGenForm({...genForm,town:e.target.value})} placeholder="e.g. Whitstable" style={inp} list="gtl"/><datalist id="gtl">{TOWNS.map(t=><option key={t} value={t}/>)}</datalist></div>
              <div><label style={{display:'block',fontSize:11,fontWeight:600,color:'var(--ink-600)',marginBottom:8,textTransform:'uppercase',letterSpacing:'0.06em'}}>Channels</label>
              <div style={{display:'flex',gap:10,flexWrap:'wrap'}}>
                {(['instagram','facebook','linkedin'] as const).map(ch=>{const c=CC[ch];const checked=genForm.channels[ch];return(
                  <label key={ch} style={{display:'flex',alignItems:'center',gap:7,cursor:'pointer',padding:'8px 12px',borderRadius:'var(--r-md)',border:'1.5px solid '+(checked?c.border:'var(--ink-200)'),background:checked?c.pill:'var(--white)'}}>
                    <input type="checkbox" checked={checked} onChange={e=>setGenForm({...genForm,channels:{...genForm.channels,[ch]:e.target.checked}})} style={{accentColor:c.border}}/>
                    <span style={{fontSize:12,fontWeight:checked?600:400,color:checked?c.text:'var(--ink-600)'}}>{CN[ch]}</span>
                  </label>);})}
              </div></div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
                <div><label style={{display:'block',fontSize:11,fontWeight:600,color:'var(--ink-600)',marginBottom:5,textTransform:'uppercase',letterSpacing:'0.06em'}}>Posts per channel</label>
                <select value={genForm.postsPerChannel} onChange={e=>setGenForm({...genForm,postsPerChannel:Number(e.target.value)})} style={{...inp,cursor:'pointer'}}>
                  <option value={2}>2 posts</option><option value={3}>3 posts</option><option value={5}>5 posts</option><option value={7}>7 posts</option>
                </select></div>
                <div><label style={{display:'block',fontSize:11,fontWeight:600,color:'var(--ink-600)',marginBottom:5,textTransform:'uppercase',letterSpacing:'0.06em'}}>Week starting</label>
                <input type="date" value={genForm.weekStart} onChange={e=>setGenForm({...genForm,weekStart:e.target.value})} style={inp}/></div>
              </div>
              <div style={{background:'var(--maroon-50)',borderRadius:'var(--r-md)',padding:'10px 12px',fontSize:11,color:'var(--maroon-700)',lineHeight:1.5}}>All posts start as drafts for your review.</div>
            </div>
            <div style={{padding:'14px 22px',borderTop:'1px solid var(--ink-100)',display:'flex',gap:8,justifyContent:'flex-end'}}>
              <button onClick={()=>setShowGen(false)} style={btnG}>Cancel</button>
              <button onClick={generate} disabled={generating||!genForm.town.trim()} style={{...btnP,opacity:generating||!genForm.town.trim()?0.6:1}}><Sparkles size={13}/>{generating?'Generating...':'Generate for '+genForm.town}</button>
            </div>
          </div>
        </div>
      )}

      {showStrats&&(
        <div style={{position:'fixed',inset:0,background:'rgba(26,13,18,0.5)',zIndex:500,display:'flex',alignItems:'center',justifyContent:'center',padding:16}} onClick={e=>{if(e.target===e.currentTarget)setShowStrats(false);}}>
          <div style={{background:'var(--white)',borderRadius:'var(--r-xl)',width:540,maxWidth:'100%',maxHeight:'80vh',overflowY:'auto',boxShadow:'var(--shadow-lg)'}}>
            <div style={{padding:'18px 22px 14px',borderBottom:'1px solid var(--ink-100)',display:'flex',justifyContent:'space-between',alignItems:'center',position:'sticky',top:0,background:'var(--white)',zIndex:1}}>
              <div style={{fontFamily:'var(--font-display)',fontSize:20,color:'var(--ink-900)'}}>Channel strategies</div>
              <button onClick={()=>setShowStrats(false)} style={{...btnG,padding:'4px 8px'}}><X size={14}/></button>
            </div>
            <div style={{padding:'16px 22px',display:'flex',flexDirection:'column',gap:10}}>
              <div style={{fontSize:12,color:'var(--ink-400)',marginBottom:4}}>Multiple strategies per channel — Roam-io uses these when generating content.</div>
              {(['instagram','facebook','linkedin'] as const).map(ch=>{const c=CC[ch];const cs=strategies.filter(s=>s.channel===ch);return(
                <div key={ch} style={{background:'var(--paper)',borderRadius:'var(--r-md)',padding:'12px 14px',border:'1px solid var(--ink-100)'}}>
                  <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:10}}>
                    <span style={{fontSize:11,padding:'3px 10px',borderRadius:'var(--r-pill)',background:c.pill,color:c.text,fontWeight:600,display:'flex',alignItems:'center',gap:5}}>{CI[ch]}{CN[ch]}</span>
                    <span style={{fontSize:11,color:'var(--ink-400)'}}>{cs.length} {cs.length===1?'strategy':'strategies'}</span>
                  </div>
                  {cs.map(s=>(
                    <div key={s.id} style={{background:'var(--white)',borderRadius:'var(--r-sm)',padding:'10px 12px',border:'1px solid var(--ink-100)',marginBottom:6}}>
                      <div style={{display:'flex',justifyContent:'space-between',marginBottom:4}}><span style={{fontSize:13,fontWeight:600,color:'var(--ink-900)'}}>{s.name}</span><span style={{fontSize:10,color:'var(--ink-400)'}}>{s.persona}</span></div>
                      <div style={{fontSize:11,color:'var(--ink-500)',marginBottom:2}}>{s.tone}</div>
                      <div style={{fontSize:11,color:'var(--ink-400)'}}>{s.contentType}</div>
                    </div>
                  ))}
                </div>);})}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
