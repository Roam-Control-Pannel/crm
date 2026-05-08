'use client';
import {useState,useEffect} from 'react';
import {Plus,CheckCircle2,Circle,AlertTriangle,Calendar,Brain,Trash2,ChevronDown,ChevronUp,Sparkles} from 'lucide-react';
import {addNotification} from '@/components/NotificationCentre';
import {loadWithMigration, saveRemote} from '@/lib/client-store';

interface Task {
  id:string;
  title:string;
  description?:string;
  priority:'high'|'medium'|'low';
  category:'outreach'|'social'|'town_activation'|'admin'|'ai_suggested';
  assignee:string;
  dueDate:string;
  completed:boolean;
  createdAt:string;
  aiSuggested?:boolean;
  actions?:{label:string;href:string}[];
}

const TEAM=['Andy','Sarah','Unassigned'];
const CATEGORIES=['outreach','social','town_activation','admin'];
const PRIORITIES=['high','medium','low'];

const pColors:Record<string,{bg:string;color:string}>={
  high:{bg:'#FCEBEB',color:'#A32D2D'},
  medium:{bg:'#FAEEDA',color:'#633806'},
  low:{bg:'var(--ink-100)',color:'var(--ink-500)'},
};
const cLabels:Record<string,string>={outreach:'Outreach',social:'Social',town_activation:'Town activation',admin:'Admin',ai_suggested:'AI suggested'};

async function fetchTasks():Promise<Task[]>{
  const data=await loadWithMigration<Task[]>('tasks');
  return Array.isArray(data)?data:[];
}
async function persistTasks(tasks:Task[]):Promise<void>{
  await saveRemote('tasks',tasks);
}
function fmtDate(s:string):string{
  const d=new Date(s);const now=new Date();
  const diff=Math.floor((d.getTime()-now.setHours(0,0,0,0))/86400000);
  if(diff<0)return 'Overdue';
  if(diff===0)return 'Due today';
  if(diff===1)return 'Due tomorrow';
  return 'Due '+d.toLocaleDateString('en-GB',{day:'numeric',month:'short'});
}
function isOverdue(s:string):boolean{return new Date(s)<new Date(new Date().setHours(0,0,0,0));}
function isDueToday(s:string):boolean{
  const d=new Date(s);const now=new Date();
  return d.getDate()===now.getDate()&&d.getMonth()===now.getMonth()&&d.getFullYear()===now.getFullYear();
}
function getInitials(name:string):string{
  if(name==='Unassigned')return '?';
  return name.split(' ').map((w:string)=>w[0]).join('').slice(0,2).toUpperCase();
}
function getAvatarBg(name:string):string{
  if(name==='Andy')return '#fbeaef';
  if(name==='Sarah')return '#e8f0fb';
  return 'var(--ink-100)';
}
function getAvatarColor(name:string):string{
  if(name==='Andy')return '#9b2752';
  if(name==='Sarah')return '#185FA5';
  return 'var(--ink-400)';
}

const AI_SUGGESTIONS:Task[]=[
  {id:'ai1',title:'Send Day 7 follow-up to non-responders',description:'14 contacts in various lists have not replied after 7 days. Send the final nudge email via Brevo.',priority:'high',category:'ai_suggested',assignee:'Andy',dueDate:new Date().toISOString().split('T')[0],completed:false,createdAt:new Date().toISOString(),aiSuggested:true,actions:[{label:'Go to Queue',href:'/queue'},{label:'Open Roam-io',href:'/hub'}]},
  {id:'ai2',title:'Activate Whitstable — 12 contacts ready',description:'You have 12 contacts in Whitstable with email addresses. Enough to start outreach and activate the town.',priority:'high',category:'ai_suggested',assignee:'Andy',dueDate:new Date().toISOString().split('T')[0],completed:false,createdAt:new Date().toISOString(),aiSuggested:true,actions:[{label:'View contacts',href:'/contacts'},{label:'Find more businesses',href:'/find'}]},
  {id:'ai3',title:'Generate social content for active towns',description:'No social posts scheduled this week. Create Instagram and LinkedIn content for your top 3 towns.',priority:'medium',category:'ai_suggested',assignee:'Unassigned',dueDate:new Date(Date.now()+2*86400000).toISOString().split('T')[0],completed:false,createdAt:new Date().toISOString(),aiSuggested:true,actions:[{label:'Social posts',href:'/social'},{label:'Open Roam-io',href:'/hub'}]},
];

export default function TasksPage(){
  const [tasks,setTasks]=useState<Task[]>([]);
  const [showAdd,setShowAdd]=useState(false);
  const [filter,setFilter]=useState({assignee:'',priority:'',category:''});
  const [showCompleted,setShowCompleted]=useState(false);
  const [showAiSuggestions,setShowAiSuggestions]=useState(true);
  const [form,setForm]=useState({title:'',description:'',priority:'medium' as 'high'|'medium'|'low',category:'outreach' as Task['category'],assignee:'Andy',dueDate:new Date().toISOString().split('T')[0]});

  useEffect(()=>{(async()=>{setTasks(await fetchTasks());})();},[]);

  function addTask(){
    if(!form.title.trim())return;
    const task:Task={id:Date.now().toString(),...form,completed:false,createdAt:new Date().toISOString()};
    const updated=[task,...tasks];setTasks(updated);persistTasks(updated);
    addNotification({type:'info',title:'Task created',body:form.title});
    setForm({title:'',description:'',priority:'medium',category:'outreach',assignee:'Andy',dueDate:new Date().toISOString().split('T')[0]});
    setShowAdd(false);
  }

  function acceptAiTask(t:Task){
    const updated=[{...t,id:Date.now().toString(),aiSuggested:true},...tasks];
    setTasks(updated);persistTasks(updated);
    addNotification({type:'info',title:'Task added',body:t.title});
  }

  function toggle(id:string){
    const updated=tasks.map(t=>t.id===id?{...t,completed:!t.completed}:t);
    setTasks(updated);persistTasks(updated);
  }

  function remove(id:string){
    const updated=tasks.filter(t=>t.id!==id);
    setTasks(updated);persistTasks(updated);
  }

  const filtered=tasks.filter(t=>{
    if(!filter.assignee&&!filter.priority&&!filter.category)return true;
    if(filter.assignee&&t.assignee!==filter.assignee)return false;
    if(filter.priority&&t.priority!==filter.priority)return false;
    if(filter.category&&t.category!==filter.category)return false;
    return true;
  });

  const open=filtered.filter(t=>!t.completed);
  const overdue=open.filter(t=>isOverdue(t.dueDate));
  const dueToday=open.filter(t=>!isOverdue(t.dueDate)&&isDueToday(t.dueDate));
  const upcoming=open.filter(t=>!isOverdue(t.dueDate)&&!isDueToday(t.dueDate));
  const done=filtered.filter(t=>t.completed);

  const inp:React.CSSProperties={padding:'8px 12px',border:'1.5px solid var(--ink-200)',borderRadius:'var(--r-md)',fontSize:13,fontFamily:'inherit',background:'var(--white)',color:'var(--ink-900)',outline:'none',width:'100%'};
  const btnP:React.CSSProperties={display:'inline-flex',alignItems:'center',gap:6,padding:'7px 14px',borderRadius:'var(--r-md)',background:'var(--maroon-700)',color:'white',fontSize:12,fontWeight:600,border:'none',cursor:'pointer'};
  const btnG:React.CSSProperties={display:'inline-flex',alignItems:'center',gap:6,padding:'7px 12px',borderRadius:'var(--r-md)',background:'var(--white)',color:'var(--ink-600)',fontSize:12,fontWeight:600,border:'1.5px solid var(--ink-200)',cursor:'pointer'};

  const TaskRow=({task}:{task:Task})=>(
    <div style={{display:'flex',alignItems:'flex-start',gap:12,padding:'13px 18px',borderBottom:'1px solid var(--ink-100)',opacity:task.completed?0.5:1}}>
      <button onClick={()=>toggle(task.id)} style={{background:'none',border:'none',cursor:'pointer',padding:0,marginTop:1,flexShrink:0,color:task.completed?'var(--ok)':'var(--ink-300)'}}>
        {task.completed?<CheckCircle2 size={18}/>:<Circle size={18}/>}
      </button>
      <div style={{flex:1,minWidth:0}}>
        <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap',marginBottom:4}}>
          <span style={{fontSize:13,fontWeight:600,color:'var(--ink-900)',textDecoration:task.completed?'line-through':'none'}}>{task.title}</span>
          <span style={{fontSize:10,padding:'2px 8px',borderRadius:'var(--r-pill)',background:pColors[task.priority].bg,color:pColors[task.priority].color,fontWeight:500}}>{task.priority}</span>
          <span style={{fontSize:10,padding:'2px 8px',borderRadius:'var(--r-pill)',background:'var(--ink-100)',color:'var(--ink-500)'}}>{cLabels[task.category]}</span>
          {task.aiSuggested&&<span style={{fontSize:10,padding:'2px 8px',borderRadius:'var(--r-pill)',background:'var(--maroon-50)',color:'var(--maroon-600)',display:'flex',alignItems:'center',gap:3}}><Sparkles size={9}/>AI</span>}
        </div>
        {task.description&&<div style={{fontSize:12,color:'var(--ink-500)',lineHeight:1.5,marginBottom:6}}>{task.description}</div>}
        <div style={{display:'flex',alignItems:'center',gap:12,flexWrap:'wrap'}}>
          {task.assignee!=='Unassigned'?(
            <div style={{display:'flex',alignItems:'center',gap:5}}>
              <div style={{width:20,height:20,borderRadius:'50%',background:getAvatarBg(task.assignee),display:'flex',alignItems:'center',justifyContent:'center',fontSize:9,fontWeight:600,color:getAvatarColor(task.assignee)}}>{getInitials(task.assignee)}</div>
              <span style={{fontSize:11,color:'var(--ink-400)'}}>{task.assignee}</span>
            </div>
          ):<span style={{fontSize:11,color:'var(--ink-300)',fontStyle:'italic'}}>Unassigned</span>}
          <span style={{fontSize:11,color:isOverdue(task.dueDate)?'var(--alert)':isDueToday(task.dueDate)?'var(--warn)':'var(--ink-400)'}}>{fmtDate(task.dueDate)}</span>
          <a href="/hub" style={{fontSize:10,padding:'2px 9px',borderRadius:'var(--r-pill)',border:'1px solid var(--ink-200)',background:'var(--white)',color:'var(--ink-500)',textDecoration:'none',display:'inline-flex',alignItems:'center',gap:4}}><Brain size={9}/>Ask Roam-io</a>
          {task.actions?.map(a=>(
            <a key={a.label} href={a.href} style={{fontSize:10,padding:'2px 9px',borderRadius:'var(--r-pill)',border:'1px solid var(--maroon-200)',background:'var(--maroon-50)',color:'var(--maroon-600)',textDecoration:'none'}}>{a.label}</a>
          ))}
        </div>
      </div>
      <button onClick={()=>remove(task.id)} style={{background:'none',border:'none',cursor:'pointer',color:'var(--ink-300)',padding:4,flexShrink:0,display:'flex',alignItems:'center'}}>
        <Trash2 size={13}/>
      </button>
    </div>
  );

  const SectionHeader=({label,count,color,icon}:{label:string;count:number;color:string;icon:React.ReactNode})=>(
    <div style={{padding:'9px 18px',background:'var(--paper)',borderBottom:'1px solid var(--ink-100)',display:'flex',alignItems:'center',gap:8}}>
      {icon}
      <span style={{fontSize:11,fontWeight:600,textTransform:'uppercase',letterSpacing:'0.08em',color}}>{label}</span>
      <span style={{fontSize:11,color:'var(--ink-400)'}}>({count})</span>
    </div>
  );

  return(
    <div style={{padding:'24px 28px'}}>
      {/* Header */}
      <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',marginBottom:20}} className="page-header">
        <div>
          <h1 style={{fontFamily:'var(--font-display)',fontSize:28,fontWeight:700,color:'var(--ink-900)',lineHeight:1}}>Tasks</h1>
          <p style={{fontSize:12,color:'var(--ink-400)',marginTop:5,fontWeight:500}}>{open.length} open · {dueToday.length} due today · {overdue.length} overdue</p>
        </div>
        <div style={{display:'flex',gap:8}} className="btn-row">
          <a href="/hub" style={{...btnG,textDecoration:'none'}}><Brain size={13}/> Ask Roam-io</a>
          <button style={btnP} onClick={()=>setShowAdd(true)}><Plus size={13}/> Add task</button>
        </div>
      </div>

      {/* Stats */}
      <div className="stat-grid" style={{marginBottom:20}}>
        {[{label:'Open',value:open.length,color:'var(--ink-800)'},{label:'Due today',value:dueToday.length,color:'var(--warn)'},{label:'Overdue',value:overdue.length,color:'var(--alert)'},{label:'Done this week',value:done.length,color:'var(--ok)'}].map(s=>(
          <div key={s.label} className="stat-card">
            <div className="stat-label">{s.label}</div>
            <div className="stat-num" style={{fontSize:28,color:s.color}}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Roam-io suggestions banner */}
      {showAiSuggestions&&(
        <div style={{background:'var(--maroon-50)',border:'1px solid var(--maroon-100)',borderRadius:'var(--r-lg)',padding:'14px 18px',marginBottom:20}}>
          <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:12}}>
            <div style={{width:28,height:28,borderRadius:'50%',background:'var(--maroon-50)',border:'1px solid var(--maroon-100)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:14}}>🦁</div>
            <div style={{flex:1}}>
              <div style={{fontSize:13,fontWeight:600,color:'var(--ink-900)'}}>Roam-io has {AI_SUGGESTIONS.length} task suggestions</div>
              <div style={{fontSize:11,color:'var(--ink-500)'}}>Based on your current CRM activity</div>
            </div>
            <button onClick={()=>setShowAiSuggestions(false)} style={{background:'none',border:'none',cursor:'pointer',color:'var(--ink-400)',fontSize:18,lineHeight:1}}>×</button>
          </div>
          <div style={{display:'flex',flexDirection:'column',gap:8}}>
            {AI_SUGGESTIONS.map(s=>(
              <div key={s.id} style={{background:'var(--white)',borderRadius:'var(--r-md)',padding:'12px 14px',border:'1px solid var(--maroon-100)',display:'flex',alignItems:'flex-start',gap:10}}>
                <Sparkles size={14} color="var(--maroon-600)" style={{marginTop:2,flexShrink:0}}/>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:13,fontWeight:600,color:'var(--ink-900)',marginBottom:2}}>{s.title}</div>
                  <div style={{fontSize:11,color:'var(--ink-500)',marginBottom:8}}>{s.description}</div>
                  <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
                    <button onClick={()=>acceptAiTask(s)} style={{fontSize:11,padding:'4px 10px',borderRadius:'var(--r-sm)',background:'var(--maroon-700)',color:'white',border:'none',cursor:'pointer',fontFamily:'inherit',display:'inline-flex',alignItems:'center',gap:4}}><Plus size={10}/>Add to tasks</button>
                    {s.actions?.map(a=>(
                      <a key={a.label} href={a.href} style={{fontSize:11,padding:'4px 10px',borderRadius:'var(--r-sm)',border:'1px solid var(--ink-200)',background:'var(--white)',color:'var(--ink-600)',textDecoration:'none',display:'inline-flex',alignItems:'center',gap:4}}>{a.label}</a>
                    ))}
                    <a href="/hub" style={{fontSize:11,padding:'4px 10px',borderRadius:'var(--r-sm)',border:'1px solid var(--maroon-200)',background:'var(--maroon-50)',color:'var(--maroon-600)',textDecoration:'none',display:'inline-flex',alignItems:'center',gap:4}}><Brain size={10}/>Discuss with Roam-io</a>
                  </div>
                </div>
                <span style={{fontSize:10,padding:'2px 8px',borderRadius:'var(--r-pill)',background:pColors[s.priority].bg,color:pColors[s.priority].color,fontWeight:500,flexShrink:0}}>{s.priority}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Filters */}
      <div style={{display:'flex',gap:8,marginBottom:16,flexWrap:'wrap'}} className="filter-bar">
        <select value={filter.assignee} onChange={e=>setFilter({...filter,assignee:e.target.value})} style={{...inp,width:'auto',minWidth:130,cursor:'pointer'}}>
          <option value="">All assignees</option>
          {TEAM.map(t=><option key={t}>{t}</option>)}
        </select>
        <select value={filter.priority} onChange={e=>setFilter({...filter,priority:e.target.value})} style={{...inp,width:'auto',minWidth:120,cursor:'pointer'}}>
          <option value="">All priorities</option>
          {PRIORITIES.map(p=><option key={p} value={p}>{p.charAt(0).toUpperCase()+p.slice(1)}</option>)}
        </select>
        <select value={filter.category} onChange={e=>setFilter({...filter,category:e.target.value})} style={{...inp,width:'auto',minWidth:150,cursor:'pointer'}}>
          <option value="">All categories</option>
          {CATEGORIES.map(c=><option key={c} value={c}>{cLabels[c]}</option>)}
        </select>
        {(filter.assignee||filter.priority||filter.category)&&<button onClick={()=>setFilter({assignee:'',priority:'',category:''})} style={{...btnG,fontSize:11}}>Clear filters</button>}
      </div>

      {/* Task list */}
      <div style={{background:'var(--white)',borderRadius:'var(--r-lg)',boxShadow:'var(--shadow-sm)',overflow:'hidden',marginBottom:16}}>
        {open.length===0&&!tasks.length?(
          <div style={{padding:48,textAlign:'center'}}>
            <CheckCircle2 size={32} color="var(--ink-200)" style={{margin:'0 auto 12px',display:'block'}}/>
            <div style={{fontFamily:'var(--font-display)',fontSize:18,color:'var(--ink-700)',marginBottom:6}}>No tasks yet</div>
            <div style={{fontSize:12,color:'var(--ink-400)',marginBottom:16}}>Add your first task or accept one of Roam-io's suggestions above</div>
            <button style={btnP} onClick={()=>setShowAdd(true)}><Plus size={13}/> Add first task</button>
          </div>
        ):(
          <>
            {overdue.length>0&&(
              <>
                <SectionHeader label="Overdue" count={overdue.length} color="var(--alert)" icon={<AlertTriangle size={13} color="var(--alert)"/>}/>
                {overdue.map(t=><TaskRow key={t.id} task={t}/>)}
              </>
            )}
            {dueToday.length>0&&(
              <>
                <SectionHeader label="Due today" count={dueToday.length} color="var(--warn)" icon={<Calendar size={13} color="var(--warn)"/>}/>
                {dueToday.map(t=><TaskRow key={t.id} task={t}/>)}
              </>
            )}
            {upcoming.length>0&&(
              <>
                <SectionHeader label="Upcoming" count={upcoming.length} color="var(--ink-400)" icon={<Calendar size={13} color="var(--ink-300)"/>}/>
                {upcoming.map(t=><TaskRow key={t.id} task={t}/>)}
              </>
            )}
          </>
        )}
      </div>

      {/* Completed */}
      {done.length>0&&(
        <div style={{background:'var(--white)',borderRadius:'var(--r-lg)',boxShadow:'var(--shadow-sm)',overflow:'hidden'}}>
          <button onClick={()=>setShowCompleted(v=>!v)} style={{width:'100%',padding:'13px 18px',display:'flex',alignItems:'center',gap:8,background:'none',border:'none',cursor:'pointer',fontFamily:'inherit'}}>
            <CheckCircle2 size={14} color="var(--ok)"/>
            <span style={{fontSize:12,fontWeight:600,color:'var(--ink-500)',textTransform:'uppercase',letterSpacing:'0.08em'}}>Completed ({done.length})</span>
            <span style={{marginLeft:'auto'}}>{showCompleted?<ChevronUp size={14} color="var(--ink-400)"/>:<ChevronDown size={14} color="var(--ink-400)"/>}</span>
          </button>
          {showCompleted&&done.map(t=><TaskRow key={t.id} task={t}/>)}
        </div>
      )}

      {/* Add task modal */}
      {showAdd&&(
        <div style={{position:'fixed',inset:0,background:'rgba(26,13,18,0.5)',zIndex:500,display:'flex',alignItems:'center',justifyContent:'center'}} onClick={e=>{if(e.target===e.currentTarget)setShowAdd(false);}}>
          <div style={{background:'var(--white)',borderRadius:'var(--r-xl)',width:520,maxWidth:'95vw',boxShadow:'var(--shadow-lg)'}}>
            <div style={{padding:'18px 22px 14px',borderBottom:'1px solid var(--ink-100)',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
              <div style={{fontFamily:'var(--font-display)',fontSize:20,color:'var(--ink-900)'}}>Add task</div>
              <button onClick={()=>setShowAdd(false)} style={{...btnG,padding:'4px 8px'}}>×</button>
            </div>
            <div style={{padding:'18px 22px',display:'flex',flexDirection:'column',gap:14}}>
              <div>
                <label style={{display:'block',fontSize:11,fontWeight:600,color:'var(--ink-600)',marginBottom:5,textTransform:'uppercase',letterSpacing:'0.06em'}}>Title *</label>
                <input value={form.title} onChange={e=>setForm({...form,title:e.target.value})} placeholder="e.g. Send follow-up to Whitstable contacts" style={inp} autoFocus/>
              </div>
              <div>
                <label style={{display:'block',fontSize:11,fontWeight:600,color:'var(--ink-600)',marginBottom:5,textTransform:'uppercase',letterSpacing:'0.06em'}}>Description</label>
                <textarea value={form.description} onChange={e=>setForm({...form,description:e.target.value})} placeholder="Optional details..." rows={2} style={{...inp,resize:'vertical'}}/>
              </div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:14}}>
                <div>
                  <label style={{display:'block',fontSize:11,fontWeight:600,color:'var(--ink-600)',marginBottom:5,textTransform:'uppercase',letterSpacing:'0.06em'}}>Priority</label>
                  <select value={form.priority} onChange={e=>setForm({...form,priority:e.target.value as Task['priority']})} style={{...inp,cursor:'pointer'}}>
                    {PRIORITIES.map(p=><option key={p} value={p}>{p.charAt(0).toUpperCase()+p.slice(1)}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{display:'block',fontSize:11,fontWeight:600,color:'var(--ink-600)',marginBottom:5,textTransform:'uppercase',letterSpacing:'0.06em'}}>Category</label>
                  <select value={form.category} onChange={e=>setForm({...form,category:e.target.value as Task['category']})} style={{...inp,cursor:'pointer'}}>
                    {CATEGORIES.map(c=><option key={c} value={c}>{cLabels[c]}</option>)}
                  </select>
                </div>
              </div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:14}}>
                <div>
                  <label style={{display:'block',fontSize:11,fontWeight:600,color:'var(--ink-600)',marginBottom:5,textTransform:'uppercase',letterSpacing:'0.06em'}}>Assign to</label>
                  <select value={form.assignee} onChange={e=>setForm({...form,assignee:e.target.value})} style={{...inp,cursor:'pointer'}}>
                    {TEAM.map(t=><option key={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{display:'block',fontSize:11,fontWeight:600,color:'var(--ink-600)',marginBottom:5,textTransform:'uppercase',letterSpacing:'0.06em'}}>Due date</label>
                  <input type="date" value={form.dueDate} onChange={e=>setForm({...form,dueDate:e.target.value})} style={inp}/>
                </div>
              </div>
            </div>
            <div style={{padding:'14px 22px',borderTop:'1px solid var(--ink-100)',display:'flex',gap:8,justifyContent:'flex-end'}}>
              <button onClick={()=>setShowAdd(false)} style={btnG}>Cancel</button>
              <button onClick={addTask} disabled={!form.title.trim()} style={{...btnP,opacity:!form.title.trim()?0.5:1}}><Plus size={13}/> Create task</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
