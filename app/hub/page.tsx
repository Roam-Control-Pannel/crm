'use client';
import {useState,useEffect,useRef} from 'react';
import {Plus,Send,Sparkles,X,Check,AlertTriangle,MessageSquare,Brain,Paperclip,Trash2,FileText} from 'lucide-react';
import {loadWithMigration, saveRemote} from '@/lib/client-store';

interface Message {
  id:string;
  role:'user'|'assistant';
  content:string;
  timestamp:Date;
  // Legacy string-CONFIRM action (kept for back-compat with old saved chats).
  confirmAction?:{type:string;label:string;detail:string;};
  // New: structured tool call awaiting confirmation. Survives reload because
  // it's persisted alongside the message in hub_chats.
  pendingTool?:{name:string;input:any;tool_use_id:string;assistantContent:any[];};
  // New: tools that already ran this turn (no confirm needed) — shown as
  // small "✓ Created task: …" chips beneath the message.
  executedTools?:{name:string;input:any}[];
  confirmed?:boolean;
  cancelled?:boolean;
}

interface Chat {
  id:string;
  title:string;
  messages:Message[];
  createdAt:Date;
  updatedAt:Date;
}

const SUGGESTIONS=[
  {icon:'📍',label:'Activate a town',prompt:'I want to activate a new town — find businesses, set up outreach and schedule social content'},
  {icon:'✉',label:'Run outreach campaign',prompt:'Show me which contacts are ready to email and help me start a personalised campaign'},
  {icon:'📊',label:'Weekly performance report',prompt:'Give me a summary of this week outreach performance and what I should focus on next'},
  {icon:'📱',label:'Generate social content',prompt:'Generate this week social media content for my active towns across Instagram and LinkedIn'},
  {icon:'🔥',label:'Show warm leads',prompt:'Which contacts have opened emails but not replied? I want to follow up with them'},
  {icon:'📋',label:'Create a new list',prompt:'Help me create a new outreach list and find businesses to add to it'},
];


interface RoamDoc{id:string;name:string;size:number;content:string;uploadedAt:string;}
async function fetchDocs():Promise<RoamDoc[]>{
  const data=await loadWithMigration<RoamDoc[]>('hub_docs');
  return Array.isArray(data)?data:[];
}
async function persistDocs(docs:RoamDoc[]):Promise<void>{
  await saveRemote('hub_docs',docs);
}
function fmtSize(b:number):string{if(b<1024)return b+"B";if(b<1048576)return Math.round(b/1024)+"KB";return Math.round(b/1048576)+"MB";}

function groupChats(chats:Chat[]):{label:string;chats:Chat[]}[]{
  const now=new Date();
  const today:Chat[]=[],yesterday:Chat[]=[],week:Chat[]=[],older:Chat[]=[];
  chats.forEach(c=>{
    const diff=Math.floor((now.getTime()-new Date(c.updatedAt).getTime())/86400000);
    if(diff===0)today.push(c);
    else if(diff===1)yesterday.push(c);
    else if(diff<7)week.push(c);
    else older.push(c);
  });
  const g=[];
  if(today.length)g.push({label:'Today',chats:today});
  if(yesterday.length)g.push({label:'Yesterday',chats:yesterday});
  if(week.length)g.push({label:'This week',chats:week});
  if(older.length)g.push({label:'Older',chats:older});
  return g;
}

interface RoamioResult{
  text:string;
  pendingTool?:{name:string;input:any;tool_use_id:string;assistantContent:any[];};
  executedTools?:{name:string;input:any}[];
}

async function callRoamio(messages:{role:string;content:string}[],docs?:RoamDoc[],pendingConfirm?:any):Promise<RoamioResult>{
  const today=new Date().toISOString().split('T')[0];
  const system=`You are Roam-io, the AI growth assistant for Roam Local — a free local business discovery app. You help the Roam team run their business outreach CRM.

Your personality: warm, encouraging and conversational — like a smart, enthusiastic colleague. But also precise, efficient and action-oriented.

Today's date is ${today}. When the user says "today", "tomorrow", "Friday" etc., resolve to an ISO yyyy-mm-dd date.

You have access to TOOLS for managing the user's task list (create_task, list_tasks, complete_task, update_task, delete_task). Use them whenever the user asks to add a task, see what's on their list, mark something done, or change/remove a task. Don't ask the user to do these things manually — call the tool.

You also have read-only context about: contacts in Brevo CRM, Google Places for finding businesses, social media channels, and city page data (known_for, history, local_tip). For now, only the task tools execute live — everything else is conversational.

RULES:
1. Be specific with numbers and data
2. Keep responses concise — use bullet points where useful
3. When a tool returns a result, summarise it briefly in your reply ("Added: Follow up with Dún Laoghaire BID, due Friday")
4. If a tool fails, explain plainly what went wrong
5. Don't pretend to do things you don't have tools for — say what you'd do and offer to walk through it`;

  const docCtx=docs&&docs.length>0?docs.map(d=>`[DOC: ${d.name}]\n${d.content}`).join("\n\n"):"";
  try{
    const body:any={
      systemPrompt:system+(docCtx?"\n\nKNOWLEDGE BASE:\n"+docCtx:""),
      messages:messages.map(m=>({role:m.role,content:m.content})),
      tools:['tasks'],
    };
    if(pendingConfirm)body.pendingConfirm=pendingConfirm;
    const res=await fetch('/api/ai/chat',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify(body),
    });
    const data=await res.json();
    if(data.error){return{text:'I am having trouble right now: '+data.error};}
    return{
      text:data.content||'',
      pendingTool:data.pendingTool,
      executedTools:data.executedTools,
    };
  }catch(e){
    return{text:'I am having trouble connecting right now. Please check the ANTHROPIC_API_KEY is set in Netlify environment variables and try again.'};
  }
}

// Human-readable label + detail for a tool call — used by both the confirm
// card (for tools that require confirmation) and the "executed" chips
// (for tools that ran silently).
function describeToolCall(name:string,input:any):{label:string;detail:string}{
  switch(name){
    case 'create_task':return{label:'Created task',detail:`"${input.title}" — ${input.priority} priority, ${input.category}, due ${input.dueDate}`};
    case 'list_tasks':return{label:'Listed tasks',detail:input.filter?`Filter: ${input.filter}`:'All open tasks'};
    case 'complete_task':return{label:'Marked complete',detail:`Task ${input.id}`};
    case 'update_task':return{label:'Update task',detail:`Task ${input.id} — ${Object.keys(input).filter(k=>k!=='id').join(', ')}`};
    case 'delete_task':return{label:'Delete task',detail:`Permanently remove task ${input.id}`};
    default:return{label:name,detail:JSON.stringify(input)};
  }
}

export default function HubPage(){
  const [chats,setChats]=useState<Chat[]>([]);
  const [activeChat,setActiveChat]=useState<Chat|null>(null);
  const [input,setInput]=useState('');
  const [loading,setLoading]=useState(false);
  const [showChannels,setShowChannels]=useState(false);
  const [isMobile,setIsMobile]=useState(false);
  const [showSuggestions,setShowSuggestions]=useState(false);
  const [showDocs,setShowDocs]=useState(false);
  const [docs,setDocs]=useState<RoamDoc[]>([]);
  const [chatsLoaded,setChatsLoaded]=useState(false);
  const fileInputRef=useRef<HTMLInputElement>(null);
  const messagesEndRef=useRef<HTMLDivElement>(null);
  const inputRef=useRef<HTMLTextAreaElement>(null);

  useEffect(()=>{
    let cancelled=false;
    (async()=>{
      const [docsData,chatsData]=await Promise.all([
        fetchDocs(),
        loadWithMigration<Chat[]>('hub_chats'),
      ]);
      if(cancelled)return;
      setDocs(docsData);
      const hydrated=Array.isArray(chatsData)?chatsData.map((c:any)=>({...c,createdAt:new Date(c.createdAt),updatedAt:new Date(c.updatedAt),messages:(c.messages||[]).map((m:any)=>({...m,timestamp:new Date(m.timestamp)}))})):[];
      setChats(hydrated);
      setChatsLoaded(true);
    })();
    const check=()=>setIsMobile(window.innerWidth<640);
    check();window.addEventListener('resize',check);
    return()=>{cancelled=true;window.removeEventListener('resize',check);};
  },[]);

  useEffect(()=>{messagesEndRef.current?.scrollIntoView({behavior:'smooth'});},[activeChat?.messages]);

  function deleteChat(id:string,e:React.MouseEvent){
    e.stopPropagation();
    const updated=chats.filter(c=>c.id!==id);
    setChats(updated);
    if(activeChat?.id===id)setActiveChat(updated[0]||null);
  }

  function newChat(){
    const chat:Chat={id:Date.now().toString(),title:'New conversation',messages:[],createdAt:new Date(),updatedAt:new Date()};
    setChats(prev=>[chat,...prev]);setActiveChat(chat);setShowChannels(false);setShowSuggestions(false);
  }

  useEffect(()=>{
    if(!chatsLoaded)return;
    saveRemote('hub_chats',chats).catch(err=>console.error('Failed to save chats:',err));
  },[chats,chatsLoaded]);

  function updateChat(chatId:string,messages:Message[],title?:string){
    const upd=(c:Chat)=>c.id===chatId?{...c,messages,title:title||c.title,updatedAt:new Date()}:c;
    setChats(prev=>prev.map(upd));
    setActiveChat(prev=>prev?.id===chatId?upd(prev):prev);
  }

  async function send(text?:string){
    const msg=(text||input).trim();
    if(!msg||loading)return;
    setInput('');

    let chat=activeChat;
    if(!chat){
      chat={id:Date.now().toString(),title:msg.slice(0,40),messages:[],createdAt:new Date(),updatedAt:new Date()};
      setChats(prev=>[chat!,...prev]);setActiveChat(chat);
    }

    setLoading(true);
    const userMsg:Message={id:Date.now().toString(),role:'user',content:msg,timestamp:new Date()};
    const title=chat.messages.length===0?msg.slice(0,40)+(msg.length>40?'…':''):chat.title;
    const newMsgs=[...chat.messages,userMsg];
    updateChat(chat.id,newMsgs,title);

    const result=await callRoamio(newMsgs.map(m=>({role:m.role,content:m.content})),docs);
    const aiMsg:Message={
      id:(Date.now()+1).toString(),
      role:'assistant',
      content:result.text||(result.pendingTool?'':'(no response)'),
      timestamp:new Date(),
      pendingTool:result.pendingTool?{...result.pendingTool,assistantContent:(result as any).assistantContent||(result.pendingTool as any).assistantContent||[]}:undefined,
      executedTools:result.executedTools,
    };
    // If the server sent assistantContent at the top level (it does), attach it.
    if((result as any).assistantContent&&result.pendingTool){
      aiMsg.pendingTool!.assistantContent=(result as any).assistantContent;
    }
    updateChat(chat.id,[...newMsgs,aiMsg],title);
    setLoading(false);
    setTimeout(()=>inputRef.current?.focus(),100);
  }

  // Legacy CONFIRM:{...} flow — kept so any saved chats still work, but new
  // sessions go through handleToolConfirm instead.
  async function handleConfirm(chatId:string,msgId:string,action:{type:string;label:string;detail:string;}){
    const chat=chats.find(c=>c.id===chatId)||activeChat;
    if(!chat)return;
    const updated=chat.messages.map(m=>m.id===msgId?{...m,confirmed:true}:m);
    updateChat(chatId,updated);
    setLoading(true);
    const history=[...updated.map(m=>({role:m.role,content:m.content})),{role:'user' as const,content:`Confirmed — please proceed with: ${action.label}`}];
    const{text}=await callRoamio(history,docs);
    const confirmMsg:Message={id:Date.now().toString(),role:'user',content:`Confirmed: ${action.label}`,timestamp:new Date()};
    const responseMsg:Message={id:(Date.now()+1).toString(),role:'assistant',content:text,timestamp:new Date()};
    updateChat(chatId,[...updated,confirmMsg,responseMsg]);
    setLoading(false);
  }

  // New structured tool-confirm flow. Server re-runs the tool with the
  // user's blessing and returns a fresh natural-language reply.
  async function handleToolConfirm(chatId:string,msgId:string,pending:{name:string;input:any;tool_use_id:string;assistantContent:any[]}){
    const chat=chats.find(c=>c.id===chatId)||activeChat;
    if(!chat)return;
    const updated=chat.messages.map(m=>m.id===msgId?{...m,confirmed:true,pendingTool:undefined}:m);
    updateChat(chatId,updated);
    setLoading(true);
    // Send up to and INCLUDING the pre-tool assistant message — the server
    // will append the tool_result and the new assistant reply.
    const history=updated.filter(m=>m.id!==msgId).map(m=>({role:m.role,content:m.content}));
    // Also include the original assistant text that preceded the tool call
    // so Claude has context. Empty content is fine.
    const lastAssistantText=chat.messages.find(m=>m.id===msgId)?.content||'';
    if(lastAssistantText)history.push({role:'assistant',content:lastAssistantText});

    const result=await callRoamio(history,docs,{
      name:pending.name,
      input:pending.input,
      tool_use_id:pending.tool_use_id,
      assistant_content:pending.assistantContent,
    });
    const responseMsg:Message={
      id:Date.now().toString(),
      role:'assistant',
      content:result.text||'Done.',
      timestamp:new Date(),
      executedTools:result.executedTools||[{name:pending.name,input:pending.input}],
    };
    updateChat(chatId,[...updated,responseMsg]);
    setLoading(false);
  }

  function handleCancel(chatId:string,msgId:string){
    const chat=chats.find(c=>c.id===chatId)||activeChat;
    if(!chat)return;
    updateChat(chatId,chat.messages.map(m=>m.id===msgId?{...m,cancelled:true}:m));
  }

  const groups=groupChats(chats);


  async function handleUpload(e:React.ChangeEvent<HTMLInputElement>){
    const file=e.target.files?.[0];if(!file)return;
    const reader=new FileReader();
    reader.onload=(ev)=>{
      const content=(ev.target?.result as string||"").slice(0,10000);
      const doc:RoamDoc={id:Date.now().toString(),name:file.name,size:file.size,content,uploadedAt:new Date().toISOString()};
      const updated=[doc,...docs].slice(0,20);
      setDocs(updated);
      persistDocs(updated).catch(err=>console.error('Failed to save docs:',err));
      const aiMsg:Message={id:(Date.now()+1).toString(),role:"assistant",content:`I have added **${file.name}** (${fmtSize(file.size)}) to your knowledge base. I will use this in our conversations when relevant. You can view and manage documents from the home screen.`,timestamp:new Date()};
      if(activeChat){updateChat(activeChat.id,[...activeChat.messages,aiMsg]);}
    };
    reader.readAsText(file);
    e.target.value="";
  }

  function handleDeleteDoc(id:string){
    const updated=docs.filter(d=>d.id!==id);
    setDocs(updated);
    persistDocs(updated).catch(err=>console.error('Failed to save docs:',err));
  }

  const ChannelList=()=>(
    <div style={{width:isMobile?'100%':220,background:'var(--maroon-900)',display:'flex',flexDirection:'column',flexShrink:0,height:'100%'}}>
      <div style={{padding:'16px 14px 12px',borderBottom:'1px solid rgba(255,255,255,0.08)'}}>
        <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:12}}>
          <div style={{width:28,height:28,borderRadius:'var(--r-sm)',background:'var(--maroon-500)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:14,flexShrink:0}}>🦁</div>
          <div>
            <div style={{color:'#fff',fontWeight:700,fontSize:13}}>Roam-io</div>
            <div style={{color:'rgba(255,255,255,0.4)',fontSize:9,letterSpacing:'0.1em',textTransform:'uppercase'}}>Growth Hub</div>
          </div>
        </div>
        <button onClick={newChat} style={{width:'100%',display:'flex',alignItems:'center',gap:8,padding:'8px 10px',borderRadius:'var(--r-sm)',background:'rgba(255,255,255,0.1)',border:'1px dashed rgba(255,255,255,0.2)',color:'rgba(255,255,255,0.8)',fontSize:12,cursor:'pointer',fontFamily:'inherit'}}>
          <Plus size={13}/> New conversation
        </button>
      </div>
      <div style={{flex:1,overflowY:'auto',padding:'8px'}}>
        {groups.length===0&&<div style={{padding:'20px 8px',fontSize:11,color:'rgba(255,255,255,0.3)',textAlign:'center',lineHeight:1.6}}>No conversations yet. Start one above.</div>}
        {groups.map(g=>(
          <div key={g.label} style={{marginBottom:12}}>
            <div style={{fontSize:9,letterSpacing:'0.12em',textTransform:'uppercase',color:'rgba(255,255,255,0.25)',padding:'4px 8px',fontWeight:500}}>{g.label}</div>
            {g.chats.map(c=>(
              <div key={c.id} style={{position:'relative',marginBottom:2}} className="chat-item">
                <button onClick={()=>{setActiveChat(c);setShowChannels(false);}} style={{width:'100%',textAlign:'left',padding:'8px 10px',paddingRight:28,borderRadius:'var(--r-sm)',background:activeChat?.id===c.id?'rgba(255,255,255,0.12)':'transparent',border:'none',cursor:'pointer',display:'block'}}>
                  <div style={{fontSize:12,color:activeChat?.id===c.id?'#fff':'rgba(255,255,255,0.65)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{c.title}</div>
                  <div style={{fontSize:10,color:'rgba(255,255,255,0.3)',marginTop:2,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{c.messages.length>0?c.messages[c.messages.length-1].content.slice(0,35)+'…':'Empty'}</div>
                </button>
                <button onClick={(e)=>deleteChat(c.id,e)} title="Delete conversation" style={{position:'absolute',right:4,top:'50%',transform:'translateY(-50%)',background:'none',border:'none',cursor:'pointer',color:'rgba(255,255,255,0.25)',padding:3,display:'flex',alignItems:'center',borderRadius:3,opacity:0}} className="delete-btn">
                  <Trash2 size={11}/>
                </button>
              </div>
            ))}
          </div>
        ))}
      </div>
      <div style={{padding:'10px 14px',borderTop:'1px solid rgba(255,255,255,0.08)',display:'flex',alignItems:'center',gap:8}}>
        <div style={{width:26,height:26,borderRadius:'50%',background:'var(--maroon-600)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:10,fontWeight:700,color:'#fff',flexShrink:0}}>RL</div>
        <div style={{color:'rgba(255,255,255,0.6)',fontSize:11,flex:1}}>Roam Local</div>
        <div style={{width:6,height:6,borderRadius:'50%',background:'var(--ok)'}}/>
      </div>
    </div>
  );

  return(
    <div style={{display:'flex',height:'100%',overflow:'hidden',background:'var(--paper)'}}>
      <style>{`@keyframes bounce{0%,60%,100%{transform:translateY(0)}30%{transform:translateY(-5px)}} .chat-item:hover .delete-btn{opacity:1!important;} .delete-btn:hover{color:rgba(255,100,100,0.8)!important;background:rgba(255,255,255,0.08)!important;}`}</style>

      {!isMobile&&<ChannelList/>}

      {isMobile&&showChannels&&(
        <>
          <div onClick={()=>setShowChannels(false)} style={{position:'fixed',inset:0,background:'rgba(26,13,18,0.5)',zIndex:200}}/>
          <div style={{position:'fixed',top:0,left:0,bottom:0,width:'80vw',maxWidth:300,zIndex:201}}><ChannelList/></div>
        </>
      )}

      <div style={{flex:1,display:'flex',flexDirection:'column',minWidth:0,overflow:'hidden'}}>
        <div style={{padding:'12px 16px',borderBottom:'1px solid var(--ink-100)',display:'flex',alignItems:'center',gap:10,background:'var(--white)',flexShrink:0}}>
          {isMobile&&<button onClick={()=>setShowChannels(true)} style={{background:'none',border:'none',cursor:'pointer',color:'var(--ink-600)',display:'flex',alignItems:'center',padding:4}}><MessageSquare size={18}/></button>}
          <div style={{width:28,height:28,borderRadius:'50%',background:'var(--maroon-50)',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0,fontSize:14}}>🦁</div>
          <div style={{flex:1,minWidth:0}}>
            <div style={{fontSize:14,fontWeight:600,color:'var(--ink-900)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{activeChat?activeChat.title:'Roam-io Growth Hub'}</div>
            <div style={{fontSize:11,color:'var(--ink-400)'}}>{activeChat?`${activeChat.messages.length} messages`:'Connected to Brevo + city pages'}</div>
          </div>
          {!activeChat&&<button onClick={newChat} style={{display:'flex',alignItems:'center',gap:6,padding:'7px 14px',borderRadius:'var(--r-md)',background:'var(--maroon-700)',color:'white',border:'none',cursor:'pointer',fontSize:12,fontWeight:600,flexShrink:0}}><Plus size={13}/> New chat</button>}
        </div>

        {!activeChat?(
          <div style={{flex:1,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',padding:'24px 20px',gap:20}}>
            <div style={{textAlign:'center'}}>
              <div style={{fontSize:36,marginBottom:8}}>🦁</div>
              <div style={{fontFamily:'var(--font-display)',fontSize:24,color:'var(--ink-900)',marginBottom:8}}>Hi, I'm Roam-io</div>
              <div style={{fontSize:13,color:'var(--ink-400)',lineHeight:1.7,maxWidth:360}}>Your Growth Hub AI assistant. I can help you activate towns, run outreach, generate social content and track your pipeline.</div>
            </div>
            <div style={{width:'100%',maxWidth:480}}>
              {!showSuggestions?(
                <button onClick={()=>setShowSuggestions(true)} style={{width:'100%',padding:'14px 18px',borderRadius:'var(--r-lg)',border:'1.5px dashed var(--ink-200)',background:'var(--white)',cursor:'pointer',display:'flex',alignItems:'center',gap:12,fontFamily:'inherit'}}>
                  <div style={{width:36,height:36,borderRadius:'var(--r-sm)',background:'var(--maroon-50)',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}><Sparkles size={16} color="var(--maroon-600)"/></div>
                  <div style={{textAlign:'left',flex:1}}>
                    <div style={{fontSize:13,fontWeight:600,color:'var(--ink-900)'}}>My suggestions</div>
                    <div style={{fontSize:11,color:'var(--ink-400)',marginTop:2}}>Click to see what Roam-io can help you with</div>
                  </div>
                  <div style={{fontSize:18,color:'var(--ink-300)'}}>›</div>
                </button>
              ):(
                <div style={{background:'var(--white)',borderRadius:'var(--r-lg)',border:'1px solid var(--ink-100)',boxShadow:'var(--shadow-sm)',overflow:'hidden'}}>
                  <div style={{padding:'12px 16px',borderBottom:'1px solid var(--ink-100)',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
                    <div style={{display:'flex',alignItems:'center',gap:8}}><Sparkles size={14} color="var(--maroon-600)"/><span style={{fontSize:13,fontWeight:600,color:'var(--ink-900)'}}>My suggestions</span></div>
                    <button onClick={()=>setShowSuggestions(false)} style={{background:'none',border:'none',cursor:'pointer',color:'var(--ink-400)',display:'flex'}}><X size={14}/></button>
                  </div>
                  <div style={{display:'grid',gridTemplateColumns:'1fr 1fr'}}>
                    {SUGGESTIONS.map((s,i)=>(
                      <button key={s.label} onClick={()=>send(s.prompt)} style={{padding:'12px 14px',textAlign:'left',background:'none',border:'none',borderBottom:i<4?'1px solid var(--ink-100)':'none',borderRight:i%2===0?'1px solid var(--ink-100)':'none',cursor:'pointer',fontFamily:'inherit'}}>
                        <div style={{fontSize:18,marginBottom:4}}>{s.icon}</div>
                        <div style={{fontSize:12,fontWeight:500,color:'var(--ink-900)'}}>{s.label}</div>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div style={{width:'100%',maxWidth:480,marginTop:8}}>
              {!showDocs?(
                <button onClick={()=>setShowDocs(true)} style={{width:'100%',padding:'14px 18px',borderRadius:'var(--r-lg)',border:'1.5px dashed var(--ink-200)',background:'var(--white)',cursor:'pointer',display:'flex',alignItems:'center',gap:12,fontFamily:'inherit'}}>
                  <div style={{width:36,height:36,borderRadius:'var(--r-sm)',background:'#e8f0fb',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}><FileText size={16} color="var(--info)"/></div>
                  <div style={{textAlign:'left',flex:1}}>
                    <div style={{fontSize:13,fontWeight:600,color:'var(--ink-900)'}}>View documents</div>
                    <div style={{fontSize:11,color:'var(--ink-400)',marginTop:2}}>{docs.length>0?`${docs.length} document${docs.length===1?'':'s'} in knowledge base`:'No documents yet'}</div>
                  </div>
                  <div style={{fontSize:18,color:'var(--ink-300)'}}>›</div>
                </button>
              ):(
                <div style={{background:'var(--white)',borderRadius:'var(--r-lg)',border:'1px solid var(--ink-100)',boxShadow:'var(--shadow-sm)',overflow:'hidden'}}>
                  <div style={{padding:'12px 16px',borderBottom:'1px solid var(--ink-100)',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
                    <div style={{display:'flex',alignItems:'center',gap:8}}><FileText size={14} color="var(--info)"/><span style={{fontSize:13,fontWeight:600,color:'var(--ink-900)'}}>Knowledge base</span></div>
                    <div style={{display:'flex',gap:8,alignItems:'center'}}>
                      <button onClick={()=>fileInputRef.current?.click()} style={{fontSize:11,padding:'4px 10px',borderRadius:'var(--r-sm)',background:'var(--maroon-700)',color:'white',border:'none',cursor:'pointer',display:'flex',alignItems:'center',gap:5,fontFamily:'inherit'}}><Paperclip size={11}/> Upload</button>
                      <button onClick={()=>setShowDocs(false)} style={{background:'none',border:'none',cursor:'pointer',color:'var(--ink-400)',display:'flex'}}><X size={14}/></button>
                    </div>
                  </div>
                  {docs.length===0?(
                    <div style={{padding:'24px',textAlign:'center'}}>
                      <FileText size={28} color="var(--ink-300)" style={{margin:'0 auto 8px',display:'block'}}/>
                      <div style={{fontSize:12,color:'var(--ink-400)',lineHeight:1.6}}>No documents yet. Upload files for Roam-io to learn from.</div>
                      <button onClick={()=>fileInputRef.current?.click()} style={{marginTop:12,fontSize:12,padding:'7px 16px',borderRadius:'var(--r-md)',background:'var(--maroon-700)',color:'white',border:'none',cursor:'pointer',fontFamily:'inherit',display:'inline-flex',alignItems:'center',gap:6}}><Paperclip size={12}/> Upload a document</button>
                    </div>
                  ):(
                    <div style={{maxHeight:220,overflowY:'auto'}}>
                      {docs.map(doc=>(
                        <div key={doc.id} style={{display:'flex',alignItems:'center',gap:10,padding:'10px 16px',borderBottom:'1px solid var(--ink-100)'}}>
                          <div style={{width:32,height:32,borderRadius:'var(--r-sm)',background:'#e8f0fb',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}><FileText size={14} color="var(--info)"/></div>
                          <div style={{flex:1,minWidth:0}}>
                            <div style={{fontSize:12,fontWeight:500,color:'var(--ink-900)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{doc.name}</div>
                            <div style={{fontSize:10,color:'var(--ink-400)',marginTop:1}}>{fmtSize(doc.size)} · {new Date(doc.uploadedAt).toLocaleDateString('en-GB',{day:'numeric',month:'short'})}</div>
                          </div>
                          <button onClick={()=>handleDeleteDoc(doc.id)} style={{width:28,height:28,borderRadius:'var(--r-xs)',border:'1.5px solid var(--ink-200)',background:'var(--white)',display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer',color:'var(--alert)',flexShrink:0}}><Trash2 size={12}/></button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
            <div style={{fontSize:11,color:'var(--ink-400)'}}>Or type anything below to start a conversation</div>
          </div>
        ):(
          <div style={{flex:1,overflowY:'auto',padding:'16px',display:'flex',flexDirection:'column',gap:14}}>
            {activeChat.messages.map(m=>(
              <div key={m.id} style={{display:'flex',flexDirection:m.role==='user'?'row-reverse':'row',gap:10,alignItems:'flex-start'}}>
                {m.role==='assistant'&&<div style={{width:26,height:26,borderRadius:'50%',background:'var(--maroon-50)',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0,marginTop:2,fontSize:12}}>🦁</div>}
                <div style={{maxWidth:'85%'}}>
                  <div style={{fontSize:10,color:'var(--ink-400)',marginBottom:4,textAlign:m.role==='user'?'right':'left'}}>{m.role==='user'?'You':'Roam-io'} · {new Date(m.timestamp).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'})}</div>
                  <div style={{background:m.role==='user'?'var(--maroon-50)':'var(--paper)',borderRadius:m.role==='user'?'var(--r-lg) 0 var(--r-lg) var(--r-lg)':'0 var(--r-lg) var(--r-lg) var(--r-lg)',padding:'11px 14px',fontSize:13,color:'var(--ink-900)',lineHeight:1.7,whiteSpace:'pre-wrap'}}>{m.content}</div>
                  {m.confirmAction&&!m.confirmed&&!m.cancelled&&(
                    <div style={{marginTop:10,background:'var(--white)',border:'1.5px solid var(--warn)',borderRadius:'var(--r-md)',padding:'12px 14px'}}>
                      <div style={{display:'flex',alignItems:'center',gap:6,marginBottom:6}}><AlertTriangle size={13} color="var(--warn)"/><span style={{fontSize:12,fontWeight:600,color:'var(--warn)'}}>Confirmation required</span></div>
                      <div style={{fontSize:12,color:'var(--ink-600)',lineHeight:1.5,marginBottom:10}}>{m.confirmAction.detail}</div>
                      <div style={{display:'flex',gap:8}}>
                        <button onClick={()=>activeChat&&handleConfirm(activeChat.id,m.id,m.confirmAction!)} style={{flex:1,fontSize:12,padding:'8px 0',background:'var(--maroon-700)',color:'white',border:'none',borderRadius:'var(--r-sm)',cursor:'pointer',fontWeight:500,display:'flex',alignItems:'center',justifyContent:'center',gap:6}}><Check size={12}/> {m.confirmAction.label}</button>
                        <button onClick={()=>activeChat&&handleCancel(activeChat.id,m.id)} style={{flex:1,fontSize:12,padding:'8px 0',border:'1.5px solid var(--ink-200)',background:'var(--white)',borderRadius:'var(--r-sm)',cursor:'pointer',color:'var(--ink-600)'}}>Cancel</button>
                      </div>
                    </div>
                  )}
                  {m.pendingTool&&!m.confirmed&&!m.cancelled&&(()=>{
                    const d=describeToolCall(m.pendingTool!.name,m.pendingTool!.input);
                    return(
                      <div style={{marginTop:10,background:'var(--white)',border:'1.5px solid var(--warn)',borderRadius:'var(--r-md)',padding:'12px 14px'}}>
                        <div style={{display:'flex',alignItems:'center',gap:6,marginBottom:6}}><AlertTriangle size={13} color="var(--warn)"/><span style={{fontSize:12,fontWeight:600,color:'var(--warn)'}}>{d.label}</span></div>
                        <div style={{fontSize:12,color:'var(--ink-600)',lineHeight:1.5,marginBottom:10}}>{d.detail}</div>
                        <div style={{display:'flex',gap:8}}>
                          <button onClick={()=>activeChat&&handleToolConfirm(activeChat.id,m.id,m.pendingTool!)} style={{flex:1,fontSize:12,padding:'8px 0',background:'var(--maroon-700)',color:'white',border:'none',borderRadius:'var(--r-sm)',cursor:'pointer',fontWeight:500,display:'flex',alignItems:'center',justifyContent:'center',gap:6}}><Check size={12}/> Confirm</button>
                          <button onClick={()=>activeChat&&handleCancel(activeChat.id,m.id)} style={{flex:1,fontSize:12,padding:'8px 0',border:'1.5px solid var(--ink-200)',background:'var(--white)',borderRadius:'var(--r-sm)',cursor:'pointer',color:'var(--ink-600)'}}>Cancel</button>
                        </div>
                      </div>
                    );
                  })()}
                  {m.executedTools&&m.executedTools.length>0&&(
                    <div style={{marginTop:6,display:'flex',flexDirection:'column',gap:4}}>
                      {m.executedTools.map((t,i)=>{
                        const d=describeToolCall(t.name,t.input);
                        return(
                          <div key={i} style={{display:'flex',alignItems:'center',gap:5,fontSize:11,color:'var(--ok)'}}>
                            <Check size={11}/> {d.label}: <span style={{color:'var(--ink-500)'}}>{d.detail}</span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {m.confirmed&&!m.executedTools&&<div style={{marginTop:6,display:'flex',alignItems:'center',gap:5,fontSize:11,color:'var(--ok)'}}><Check size={11}/> Action confirmed</div>}
                  {m.cancelled&&<div style={{marginTop:6,fontSize:11,color:'var(--ink-400)'}}>Action cancelled</div>}
                </div>
              </div>
            ))}
            {loading&&(
              <div style={{display:'flex',gap:10,alignItems:'flex-start'}}>
                <div style={{width:26,height:26,borderRadius:'50%',background:'var(--maroon-50)',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0,fontSize:12}}>🦁</div>
                <div style={{background:'var(--paper)',borderRadius:'0 var(--r-lg) var(--r-lg) var(--r-lg)',padding:'12px 16px',display:'flex',gap:5,alignItems:'center'}}>
                  {[0,1,2].map(i=><div key={i} style={{width:6,height:6,borderRadius:'50%',background:'var(--ink-300)',animation:`bounce 1.2s ease-in-out ${i*0.2}s infinite`}}/>)}
                </div>
              </div>
            )}
            <div ref={messagesEndRef}/>
          </div>
        )}

        <div style={{padding:'12px 16px',borderTop:'1px solid var(--ink-100)',background:'var(--white)',flexShrink:0}}>
          {!activeChat&&(
            <div style={{marginBottom:8,display:'flex',gap:6,flexWrap:'wrap'}}>
              {['Activate Whitstable','Show warm leads','Weekly report','Generate Instagram content'].map(s=>(
                <button key={s} onClick={()=>send(s)} style={{fontSize:11,padding:'4px 11px',borderRadius:'var(--r-pill)',border:'1px solid var(--ink-200)',background:'var(--white)',cursor:'pointer',color:'var(--ink-600)',fontFamily:'inherit'}}>{s}</button>
              ))}
            </div>
          )}
          <div style={{display:'flex',gap:8,alignItems:'flex-end'}}>
            <input ref={fileInputRef} type="file" accept=".txt,.pdf,.csv,.md" onChange={handleUpload} style={{display:"none"}}/>
            <textarea ref={inputRef} value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send();}}} placeholder={activeChat?'Continue the conversation… (Enter to send)':'Ask Roam-io anything…'} rows={2} disabled={loading} style={{flex:1,fontSize:13,padding:'9px 12px',border:'1.5px solid var(--ink-200)',borderRadius:'var(--r-md)',fontFamily:'inherit',color:'var(--ink-900)',background:'var(--white)',resize:'none',outline:'none'}}/>
            <button onClick={()=>fileInputRef.current?.click()} title="Upload to knowledge base" style={{width:40,height:40,borderRadius:"var(--r-md)",background:"var(--ink-100)",border:"none",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}><Paperclip size={15} color="var(--ink-500)"/></button>
            <button onClick={()=>send()} disabled={!input.trim()||loading} style={{width:40,height:40,borderRadius:'var(--r-md)',background:input.trim()&&!loading?'var(--maroon-700)':'var(--ink-200)',border:'none',cursor:input.trim()&&!loading?'pointer':'default',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0,transition:'background 0.15s'}}>
              <Send size={15} color="white"/>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
