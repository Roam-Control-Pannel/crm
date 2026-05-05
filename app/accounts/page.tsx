'use client';
import {useState,useEffect} from 'react';
import {Plus,X,Edit3,Trash2,Check} from 'lucide-react';

interface SocialAccount {
  id:string;
  handle:string;
  platform:'instagram'|'facebook'|'linkedin'|'x';
  region?:string;
  audience:string;
  tone:string;
  contentBrief:string;
  hashtags:string;
  color:string;
  active:boolean;
  createdAt:string;
}

const PLATFORM_COLORS:Record<string,{bg:string;border:string;text:string;icon:string}>={
  instagram:{bg:'#fbeaef',border:'#9b2752',text:'#6B1230',icon:'#9b2752'},
  facebook:{bg:'#dde9f7',border:'#3b5998',text:'#1a3a6b',icon:'#3b5998'},
  linkedin:{bg:'#e8f0fb',border:'#185FA5',text:'#0C447C',icon:'#185FA5'},
  x:{bg:'#f0f0f0',border:'#333',text:'#111',icon:'#333'},
};

const ACCOUNT_COLORS=['#9b2752','#185FA5','#3b5998','#2f7a4f','#c47a1a','#7c3aed','#0891b2','#dc2626'];

const DEFAULT_ACCOUNTS:SocialAccount[]=[
  {id:'acc1',handle:'@roamlocalapp',platform:'instagram',region:'UK',audience:'Local explorers, town visitors, food lovers',tone:'Warm, visual, discovery-led, inspiring',contentBrief:'Town features, hidden gems, food scenes, independent businesses, coastal and countryside spots',hashtags:'#RoamLocal #HiddenGems #IndependentBusiness #LocalLove #DiscoverUK',color:'#9b2752',active:true,createdAt:new Date().toISOString()},
  {id:'acc2',handle:'@roam_ni',platform:'instagram',region:'Northern Ireland',audience:'Northern Ireland locals, NI visitors, NI business owners',tone:'Local pride, community warmth, NI personality',contentBrief:'NI towns, local businesses, NI food and culture, community stories, stunning NI landscapes',hashtags:'#RoamNI #NorthernIreland #LoveNI #NIBusiness #ExploreNI',color:'#c47a1a',active:true,createdAt:new Date().toISOString()},
  {id:'acc3',handle:'Roam Local',platform:'facebook',region:'UK',audience:'Local community, families, town residents',tone:'Friendly, community-first, conversational, approachable',contentBrief:'Local events, community news, business spotlights, town life, family-friendly discoveries',hashtags:'#LocalLife #CommunityFirst #ShopLocal #SupportLocal',color:'#3b5998',active:true,createdAt:new Date().toISOString()},
  {id:'acc4',handle:'Roam NI',platform:'facebook',region:'Northern Ireland',audience:'NI community, local families, NI residents',tone:'Warm NI voice, community pride, inclusive, friendly',contentBrief:'NI community news, local events, business features, NI life and culture',hashtags:'#RoamNI #NICommunity #LoveNI #NILife',color:'#2f7a4f',active:true,createdAt:new Date().toISOString()},
  {id:'acc5',handle:'@roamforbusiness',platform:'linkedin',region:'UK',audience:'Local business owners, entrepreneurs, SME decision makers',tone:'Professional, growth-focused, empowering, data-driven',contentBrief:'Business spotlights, listing benefits, growth stats, founder stories, local economy insights',hashtags:'#LocalBusiness #IndependentBusiness #SmallBusiness #UKBusiness #SupportLocal',color:'#185FA5',active:true,createdAt:new Date().toISOString()},
];

function getAccounts():SocialAccount[]{
  try{const s=localStorage.getItem('roam_accounts');return s?JSON.parse(s):DEFAULT_ACCOUNTS;}catch{return DEFAULT_ACCOUNTS;}
}
function saveAccounts(a:SocialAccount[]){
  try{localStorage.setItem('roam_accounts',JSON.stringify(a));}catch{}
}

function PlatformIcon({platform,size=14,color}:{platform:string;size?:number;color?:string}){
  const c=color||PLATFORM_COLORS[platform]?.icon||'currentColor';
  if(platform==='instagram')return<svg width={size} height={size} viewBox="0 0 24 24" fill="none"><rect x="2" y="2" width="20" height="20" rx="5" stroke={c} strokeWidth="1.5"/><circle cx="12" cy="12" r="4" stroke={c} strokeWidth="1.5"/><circle cx="17.5" cy="6.5" r="1" fill={c}/></svg>;
  if(platform==='facebook')return<svg width={size} height={size} viewBox="0 0 24 24" fill="none"><path d="M18 2h-3a5 5 0 00-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 011-1h3z" stroke={c} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>;
  if(platform==='linkedin')return<svg width={size} height={size} viewBox="0 0 24 24" fill="none"><path d="M16 8a6 6 0 016 6v7h-4v-7a2 2 0 00-2-2 2 2 0 00-2 2v7h-4v-7a6 6 0 016-6z" stroke={c} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/><rect x="2" y="9" width="4" height="12" stroke={c} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/><circle cx="4" cy="4" r="2" stroke={c} strokeWidth="1.5"/></svg>;
  return<svg width={size} height={size} viewBox="0 0 24 24" fill="none"><path d="M22 4L12 14.01l-3-3" stroke={c} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>;
}

const blank={handle:'',platform:'instagram' as SocialAccount['platform'],region:'',audience:'',tone:'',contentBrief:'',hashtags:'',color:ACCOUNT_COLORS[0],active:true};

export default function AccountsPage(){
  const [accounts,setAccounts]=useState<SocialAccount[]>([]);
  const [showForm,setShowForm]=useState(false);
  const [editAcc,setEditAcc]=useState<SocialAccount|null>(null);
  const [form,setForm]=useState(blank);
  const [filter,setFilter]=useState('all');

  useEffect(()=>{setAccounts(getAccounts());},[]);

  function saveAndSet(a:SocialAccount[]){setAccounts(a);saveAccounts(a);}

  function openAdd(){setEditAcc(null);setForm(blank);setShowForm(true);}
  function openEdit(a:SocialAccount){setEditAcc(a);setForm({handle:a.handle,platform:a.platform,region:a.region||'',audience:a.audience,tone:a.tone,contentBrief:a.contentBrief,hashtags:a.hashtags,color:a.color,active:a.active});setShowForm(true);}

  function save(){
    if(!form.handle.trim())return;
    if(editAcc){
      saveAndSet(accounts.map(a=>a.id===editAcc.id?{...a,...form}:a));
    }else{
      const na:SocialAccount={id:Date.now().toString(),...form,createdAt:new Date().toISOString()};
      saveAndSet([...accounts,na]);
    }
    setShowForm(false);
  }

  function remove(id:string){saveAndSet(accounts.filter(a=>a.id!==id));}
  function toggle(id:string){saveAndSet(accounts.map(a=>a.id===id?{...a,active:!a.active}:a));}

  const filtered=accounts.filter(a=>filter==='all'||a.platform===filter);

  const inp:React.CSSProperties={padding:'8px 12px',border:'1.5px solid var(--ink-200)',borderRadius:'var(--r-md)',fontSize:13,fontFamily:'inherit',background:'var(--white)',color:'var(--ink-900)',outline:'none',width:'100%'};
  const btnP:React.CSSProperties={display:'inline-flex',alignItems:'center',gap:6,padding:'8px 16px',borderRadius:'var(--r-md)',background:'var(--maroon-700)',color:'white',fontSize:12.5,fontWeight:600,border:'none',cursor:'pointer'};
  const btnG:React.CSSProperties={display:'inline-flex',alignItems:'center',gap:6,padding:'8px 14px',borderRadius:'var(--r-md)',background:'var(--white)',color:'var(--ink-700)',fontSize:12.5,fontWeight:600,border:'1.5px solid var(--ink-200)',cursor:'pointer'};

  const platforms=['all','instagram','facebook','linkedin'];
  const pNames:Record<string,string>={all:'All platforms',instagram:'Instagram',facebook:'Facebook',linkedin:'LinkedIn'};

  return(
    <div style={{padding:'24px 28px'}}>
      <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',marginBottom:20}} className="page-header">
        <div>
          <h1 style={{fontFamily:'var(--font-display)',fontSize:28,fontWeight:700,color:'var(--ink-900)',lineHeight:1}}>Social Accounts</h1>
          <p style={{fontSize:12,color:'var(--ink-400)',marginTop:5,fontWeight:500}}>{accounts.filter(a=>a.active).length} active · {accounts.length} total · each with their own strategy brief</p>
        </div>
        <button style={btnP} onClick={openAdd}><Plus size={13}/> Add account</button>
      </div>

      <div style={{display:'flex',gap:6,marginBottom:20,flexWrap:'wrap'}}>
        {platforms.map(p=>(
          <button key={p} onClick={()=>setFilter(p)} style={{fontSize:11,padding:'5px 14px',borderRadius:'var(--r-pill)',border:`1.5px solid ${filter===p?'var(--maroon-700)':'var(--ink-200)'}`,background:filter===p?'var(--maroon-50)':'var(--white)',color:filter===p?'var(--maroon-700)':'var(--ink-500)',cursor:'pointer',fontWeight:filter===p?600:400,display:'flex',alignItems:'center',gap:6}}>
            {p!=='all'&&<PlatformIcon platform={p} size={12}/>}
            {pNames[p]}
          </button>
        ))}
      </div>

      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(320px,1fr))',gap:14,marginBottom:16}}>
        {filtered.map(acc=>{
          const pc=PLATFORM_COLORS[acc.platform];
          return(
            <div key={acc.id} style={{background:'var(--white)',border:'1px solid var(--ink-100)',borderRadius:'var(--r-lg)',overflow:'hidden',opacity:acc.active?1:0.6}}>
              <div style={{padding:'14px 16px',borderBottom:'1px solid var(--ink-100)',display:'flex',alignItems:'center',gap:10}}>
                <div style={{width:38,height:38,borderRadius:'50%',background:pc.bg,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
                  <PlatformIcon platform={acc.platform} size={16}/>
                </div>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:14,fontWeight:600,color:'var(--ink-900)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{acc.handle}</div>
                  <div style={{fontSize:11,color:'var(--ink-400)',display:'flex',alignItems:'center',gap:6}}>
                    <span style={{padding:'1px 7px',borderRadius:'var(--r-pill)',background:pc.bg,color:pc.text,fontWeight:500,display:'inline-flex',alignItems:'center',gap:4}}>
                      <PlatformIcon platform={acc.platform} size={10}/>{acc.platform.charAt(0).toUpperCase()+acc.platform.slice(1)}
                    </span>
                    {acc.region&&<span>{acc.region}</span>}
                  </div>
                </div>
                <div style={{display:'flex',alignItems:'center',gap:6,flexShrink:0}}>
                  <div style={{width:8,height:8,borderRadius:'50%',background:acc.active?'var(--ok)':'var(--ink-300)'}}/>
                  <span style={{fontSize:10,color:acc.active?'var(--ok)':'var(--ink-400)'}}>{acc.active?'Active':'Paused'}</span>
                </div>
              </div>
              <div style={{padding:'12px 16px',display:'flex',flexDirection:'column',gap:7}}>
                <div style={{fontSize:11,color:'var(--ink-600)',lineHeight:1.5}}><span style={{fontWeight:600,color:'var(--ink-800)'}}>Audience: </span>{acc.audience}</div>
                <div style={{fontSize:11,color:'var(--ink-600)',lineHeight:1.5}}><span style={{fontWeight:600,color:'var(--ink-800)'}}>Tone: </span>{acc.tone}</div>
                <div style={{fontSize:11,color:'var(--ink-600)',lineHeight:1.5}}><span style={{fontWeight:600,color:'var(--ink-800)'}}>Content: </span>{acc.contentBrief}</div>
                <div style={{fontSize:11,color:'var(--ink-400)',marginTop:2,lineHeight:1.5}}>{acc.hashtags}</div>
              </div>
              <div style={{padding:'10px 16px',borderTop:'1px solid var(--ink-100)',display:'flex',gap:6}}>
                <button onClick={()=>toggle(acc.id)} style={{...btnG,fontSize:11,padding:'5px 10px',flex:1}}>{acc.active?'Pause':'Activate'}</button>
                <button onClick={()=>openEdit(acc)} style={{...btnG,fontSize:11,padding:'5px 10px',flex:1}}><Edit3 size={11}/>Edit brief</button>
                <button onClick={()=>remove(acc.id)} style={{width:30,height:30,borderRadius:'var(--r-xs)',border:'1.5px solid var(--ink-200)',background:'var(--white)',display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer',color:'var(--alert)',flexShrink:0}}><Trash2 size={12}/></button>
              </div>
            </div>
          );
        })}

        <div onClick={openAdd} style={{background:'var(--paper)',border:'1.5px dashed var(--ink-200)',borderRadius:'var(--r-lg)',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',padding:'32px 20px',gap:10,cursor:'pointer',minHeight:200}}>
          <div style={{width:36,height:36,borderRadius:'50%',background:'var(--white)',border:'1px solid var(--ink-200)',display:'flex',alignItems:'center',justifyContent:'center'}}>
            <Plus size={16} color="var(--ink-400)"/>
          </div>
          <div style={{fontSize:13,fontWeight:600,color:'var(--ink-500)'}}>Add new account</div>
          <div style={{fontSize:11,color:'var(--ink-400)',textAlign:'center'}}>Instagram, Facebook, LinkedIn or X</div>
        </div>
      </div>

      {showForm&&(
        <div style={{position:'fixed',inset:0,background:'rgba(26,13,18,0.5)',zIndex:500,display:'flex',alignItems:'center',justifyContent:'center',padding:16}} onClick={e=>{if(e.target===e.currentTarget)setShowForm(false);}}>
          <div style={{background:'var(--white)',borderRadius:'var(--r-xl)',width:560,maxWidth:'100%',maxHeight:'90vh',overflowY:'auto',boxShadow:'var(--shadow-lg)'}}>
            <div style={{padding:'18px 22px 14px',borderBottom:'1px solid var(--ink-100)',display:'flex',justifyContent:'space-between',alignItems:'center',position:'sticky',top:0,background:'var(--white)',zIndex:1}}>
              <div style={{fontFamily:'var(--font-display)',fontSize:20,color:'var(--ink-900)'}}>{editAcc?'Edit account':'Add account'}</div>
              <button onClick={()=>setShowForm(false)} style={{...btnG,padding:'4px 8px'}}><X size={14}/></button>
            </div>
            <div style={{padding:'18px 22px',display:'flex',flexDirection:'column',gap:14}}>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
                <div>
                  <label style={{display:'block',fontSize:11,fontWeight:600,color:'var(--ink-600)',marginBottom:5,textTransform:'uppercase',letterSpacing:'0.06em'}}>Handle / Name *</label>
                  <input value={form.handle} onChange={e=>setForm({...form,handle:e.target.value})} placeholder="e.g. @roamlocalapp" style={inp} autoFocus/>
                </div>
                <div>
                  <label style={{display:'block',fontSize:11,fontWeight:600,color:'var(--ink-600)',marginBottom:5,textTransform:'uppercase',letterSpacing:'0.06em'}}>Platform</label>
                  <select value={form.platform} onChange={e=>setForm({...form,platform:e.target.value as SocialAccount['platform']})} style={{...inp,cursor:'pointer'}}>
                    <option value="instagram">Instagram</option>
                    <option value="facebook">Facebook</option>
                    <option value="linkedin">LinkedIn</option>
                    <option value="x">X / Twitter</option>
                  </select>
                </div>
              </div>
              <div>
                <label style={{display:'block',fontSize:11,fontWeight:600,color:'var(--ink-600)',marginBottom:5,textTransform:'uppercase',letterSpacing:'0.06em'}}>Region / Focus (optional)</label>
                <input value={form.region} onChange={e=>setForm({...form,region:e.target.value})} placeholder="e.g. Northern Ireland, Scotland, UK-wide" style={inp}/>
              </div>
              <div>
                <label style={{display:'block',fontSize:11,fontWeight:600,color:'var(--ink-600)',marginBottom:5,textTransform:'uppercase',letterSpacing:'0.06em'}}>Audience</label>
                <input value={form.audience} onChange={e=>setForm({...form,audience:e.target.value})} placeholder="Who follows this account?" style={inp}/>
              </div>
              <div>
                <label style={{display:'block',fontSize:11,fontWeight:600,color:'var(--ink-600)',marginBottom:5,textTransform:'uppercase',letterSpacing:'0.06em'}}>Tone of voice</label>
                <input value={form.tone} onChange={e=>setForm({...form,tone:e.target.value})} placeholder="e.g. Warm, visual, community-first, inspiring" style={inp}/>
              </div>
              <div>
                <label style={{display:'block',fontSize:11,fontWeight:600,color:'var(--ink-600)',marginBottom:5,textTransform:'uppercase',letterSpacing:'0.06em'}}>Content brief</label>
                <textarea value={form.contentBrief} onChange={e=>setForm({...form,contentBrief:e.target.value})} placeholder="What does this account post about? Topics, themes, formats..." rows={3} style={{...inp,resize:'vertical'}}/>
              </div>
              <div>
                <label style={{display:'block',fontSize:11,fontWeight:600,color:'var(--ink-600)',marginBottom:5,textTransform:'uppercase',letterSpacing:'0.06em'}}>Default hashtags</label>
                <input value={form.hashtags} onChange={e=>setForm({...form,hashtags:e.target.value})} placeholder="#RoamLocal #HiddenGems #LocalBusiness" style={inp}/>
              </div>
              <div>
                <label style={{display:'block',fontSize:11,fontWeight:600,color:'var(--ink-600)',marginBottom:8,textTransform:'uppercase',letterSpacing:'0.06em'}}>Account colour</label>
                <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
                  {ACCOUNT_COLORS.map(c=>(
                    <button key={c} onClick={()=>setForm({...form,color:c})} style={{width:28,height:28,borderRadius:'50%',background:c,border:`3px solid ${form.color===c?'var(--ink-900)':'transparent'}`,cursor:'pointer',outline:'none'}}/>
                  ))}
                </div>
              </div>
            </div>
            <div style={{padding:'14px 22px',borderTop:'1px solid var(--ink-100)',display:'flex',gap:8,justifyContent:'flex-end',position:'sticky',bottom:0,background:'var(--white)'}}>
              <button onClick={()=>setShowForm(false)} style={btnG}>Cancel</button>
              <button onClick={save} disabled={!form.handle.trim()} style={{...btnP,opacity:!form.handle.trim()?0.5:1}}><Check size={13}/>{editAcc?'Save changes':'Add account'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
