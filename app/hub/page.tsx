'use client';
import {useState,useEffect,useRef} from 'react';
import {Plus,Send,Sparkles,X,Check,AlertTriangle,MessageSquare,Brain,Paperclip,Trash2,FileText,Bookmark,BookmarkCheck,Image as ImageIcon,Camera,Pencil,Pin,PinOff} from 'lucide-react';
import {saveTextToBrain,uploadChatImage,fetchMemories,fetchMemoryContent,saveMemory,deleteItem,type BrainItem} from '@/lib/brain';
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
  // Set true once this message has been saved to Brain via the bookmark.
  // Persisted so the bookmark stays "saved" across reloads.
  savedToBrain?:boolean;
  // Image attachments — references to Brain items, NOT base64. Keeps the
  // hub_chats JSON small; we render via /api/images/[blobId].
  attachments?:{blobId:string;mime:string;description?:string}[];
}

interface Chat {
  id:string;
  title:string;
  messages:Message[];
  createdAt:Date;
  updatedAt:Date;
  // Memory extraction watermark. We only mine messages newer than this
  // id, so re-opening a chat never re-extracts the same facts.
  lastExtractedMessageId?:string;
  // When the most-recent extraction ran. Used for "2 min idle" gating.
  lastExtractedAt?:string;
  // Whether this chat is pinned to the top of the sidebar. Pinned chats
  // render in their own section above the date-grouped buckets so the
  // user can keep important conversations one click away.
  pinned?:boolean;
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
// Knowledge base is now backed by the Brain. The hub lists Brain documents
// (markdown + binary uploads) so anything saved or uploaded shows up in both
// places. The AI uses the search_brain / read_brain_item tools to actually
// read content on demand — we no longer ship doc bodies in the system prompt.
async function fetchDocs():Promise<RoamDoc[]>{
  try {
    const res = await fetch('/api/brain/search?type=document&limit=20', { cache: 'no-store' });
    if (!res.ok) return [];
    const d = await res.json();
    const items: any[] = Array.isArray(d.items) ? d.items : [];
    return items.map(i => ({
      id: i.id,
      name: i.description || 'Untitled document',
      size: i.size || 0,
      content: '', // populated lazily by the AI via search_brain/read_brain_item
      uploadedAt: i.uploadedAt || new Date().toISOString(),
    }));
  } catch {
    return [];
  }
}
async function persistDocs(_docs:RoamDoc[]):Promise<void>{
  // No-op: docs are persisted in the Brain by the underlying upload/delete
  // calls. Kept here so existing call sites don't need to change.
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

// Message shape going to the API: content may be either a plain string
// (most turns) or an array of content blocks (when the user attached
// images — Claude vision requires the structured form).
type ApiMessage={role:string;content:string|any[]};

async function callRoamio(messages:ApiMessage[],docs?:RoamDoc[],pendingConfirm?:any,memoryContext?:string):Promise<RoamioResult>{
  const today=new Date().toISOString().split('T')[0];
  const system=`You are Roam-io, the AI growth assistant for Roam Local — a free local business discovery app. You help the Roam team run their business outreach CRM.

Your personality: warm, encouraging and conversational — like a smart, enthusiastic colleague. But also precise, efficient and action-oriented.

Today's date is ${today}. When the user says "today", "tomorrow", "Friday" etc., resolve to an ISO yyyy-mm-dd date.

You have access to TOOLS for managing the user's task list (create_task, list_tasks, complete_task, update_task, delete_task). Use them whenever the user asks to add a task, see what's on their list, mark something done, or change/remove a task. Don't ask the user to do these things manually — call the tool.

BRAIN TOOLS — the user's knowledge base lives in the Brain. You have four tools:
- save_to_brain: save short text snippets the user shares (partnerships, contacts, decisions, key numbers). Use proactively but only for durable, non-trivial things. 2-5 short tags. Confirms before saving.
- search_brain: search the Brain by query, tags, folder, or type. Use this BEFORE answering questions that reference past saves, uploaded documents, or anything the user may have stored. Returns metadata only.
- read_brain_item: fetch the full body of a specific Brain item by id. Use after search_brain when you need to quote, summarise, or build on what's saved.
- generate_document: write a new document into the Brain. Use when the user asks you to draft, write, produce, or compile something they want to keep — strategy notes, meeting recaps, partnership briefs, town research. Search the Brain first to ground the doc in what's already saved. Documents land in "Roam-io documents" and are downloadable as Markdown or PDF from the Brain page.

You have SOCIAL MEDIA TOOLS for the user's content calendar (briefs Roam Local / Roam NI / Roam for Business, themes, connected accounts, drafts and scheduled posts):
- Reads: list_briefs, list_themes, list_accounts, list_social_posts, get_post, analyse_calendar
- Writes: create_post_draft, regenerate_caption (both silent), reschedule_post, delete_post, bulk_fill_calendar (all gated by confirm card)
- Strategic: plan_content_week (proposes a schedule; doesn't save until you call create_post_draft per slot)

When the user asks "what's on my calendar this week", use list_social_posts with a date range. When they say "draft a post for X", you usually need to resolve brief id (list_briefs) and account id (list_accounts) first, then call create_post_draft.

IMAGE PICKING is opt-in. If the user doesn't mention images, leave withImage='none' and ASK in your reply ("Want me to find an image? Brain or Unsplash?"). Only pass withImage='brain' or 'unsplash' when the user explicitly says they want one.

You also have read-only context about: contacts in Brevo CRM, Google Places for finding businesses, and city page data (known_for, history, local_tip). Tasks, brain, and social tools execute live — other systems are conversational.

RULES:
1. Be specific with numbers and data
2. Keep responses concise — use bullet points where useful
3. When a tool returns a result, summarise it briefly in your reply ("Added: Follow up with Dún Laoghaire BID, due Friday")
4. If a tool fails, explain plainly what went wrong
5. Don't pretend to do things you don't have tools for — say what you'd do and offer to walk through it
6. When the user shares an image, respond naturally and conversationally about what you see — don't dump structured analysis unless asked. Tie it back to their work (high streets, partnerships, branding, social content) where it's relevant.
7. If MEMORIES are attached, use them naturally — like a colleague who remembers context. Don't announce "I remember that...", just reference the fact ("Sarah at Dún Laoghaire BID — want me to draft a note to her?"). Trust the memory unless the current conversation contradicts it; if it does, follow the current conversation.`;

  // Knowledge base is no longer injected into the system prompt — the AI
  // searches the Brain on demand via search_brain / read_brain_item. This
  // saves tokens and scales to a Brain of any size.
  const brainHint=docs&&docs.length>0?`\n\nThe user has ${docs.length} document${docs.length===1?'':'s'} saved in their Brain. Use search_brain (then read_brain_item) to look things up before answering questions that reference past saves, uploaded docs, or topics they may have stored.`:"";
  const memCtx=memoryContext?`\n\nMEMORIES (things you've learned about Andy in previous conversations — use these naturally, do not announce them):\n${memoryContext}`:"";
  try{
    const body:any={
      systemPrompt:system+brainHint+memCtx,
      // Pass content through verbatim — may be string or content-block array.
      messages:messages.map(m=>({role:m.role,content:m.content})),
      tools:['tasks','brain','social'],
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
  // Pre-fill the composer when the user lands here via /hub?prompt=… (used
  // by the Brain page's "Generate with Roam-io" CTA). Done synchronously so
  // the first paint shows the suggested prompt already typed.
  const initialPrompt = typeof window !== 'undefined'
    ? new URLSearchParams(window.location.search).get('prompt') || ''
    : '';

  const [chats,setChats]=useState<Chat[]>([]);
  const [activeChat,setActiveChat]=useState<Chat|null>(null);
  const [input,setInput]=useState(initialPrompt);
  const [loading,setLoading]=useState(false);
  const [showChannels,setShowChannels]=useState(false);
  const [isMobile,setIsMobile]=useState(false);
  const [showSuggestions,setShowSuggestions]=useState(false);
  const [showDocs,setShowDocs]=useState(false);
  const [docs,setDocs]=useState<RoamDoc[]>([]);
  const [chatsLoaded,setChatsLoaded]=useState(false);
  const [savingMsgId,setSavingMsgId]=useState<string|null>(null);
  const [savingChat,setSavingChat]=useState(false);
  const [toast,setToast]=useState<string|null>(null);
  // Memory state — items themselves plus their text contents (cached).
  const [memories,setMemories]=useState<BrainItem[]>([]);
  const [memoryContents,setMemoryContents]=useState<Record<string,string>>({});
  const [showMemories,setShowMemories]=useState(false);
  const [extracting,setExtracting]=useState(false);
  // Pending image attachments — uploaded to Brain on send, never persisted
  // in state across renders if the user navigates away mid-compose.
  const [pendingAttachments,setPendingAttachments]=useState<{file:File;preview:string}[]>([]);
  const [showAttachMenu,setShowAttachMenu]=useState(false);
  const [uploadingImage,setUploadingImage]=useState(false);
  // Inline rename UI state — when set, the matching chat row in the sidebar
  // swaps its title for an editable input. Draft holds the in-progress text.
  const [renamingChatId,setRenamingChatId]=useState<string|null>(null);
  const [renameDraft,setRenameDraft]=useState('');
  const fileInputRef=useRef<HTMLInputElement>(null);
  const imageInputRef=useRef<HTMLInputElement>(null);
  const cameraInputRef=useRef<HTMLInputElement>(null);
  const messagesEndRef=useRef<HTMLDivElement>(null);
  const inputRef=useRef<HTMLTextAreaElement>(null);

  // Lightweight toast — auto-dismisses after 2.4s.
  function showToast(text:string){
    setToast(text);
    setTimeout(()=>setToast(null),2400);
  }

  function handleImagePicked(e:React.ChangeEvent<HTMLInputElement>){
    const files=Array.from(e.target.files||[]);
    if(files.length===0)return;
    const valid=files.filter(f=>f.type.startsWith('image/')&&f.size<=8*1024*1024);
    if(valid.length<files.length){
      showToast('Some files skipped (not an image or > 8MB)');
    }
    const newOnes=valid.map(file=>({file,preview:URL.createObjectURL(file)}));
    setPendingAttachments(prev=>[...prev,...newOnes]);
    setShowAttachMenu(false);
    e.target.value='';
  }

  function removePendingAttachment(idx:number){
    setPendingAttachments(prev=>{
      const next=[...prev];
      const removed=next.splice(idx,1)[0];
      if(removed)URL.revokeObjectURL(removed.preview);
      return next;
    });
  }

  // Read a File as base64 for sending to the vision model. We need this
  // even though we ALSO upload the image to Brain, because the Brain item
  // returns a blobId, not raw bytes. Cheaper to do it once here than to
  // re-download the image from /api/images on the server.
  function fileToBase64(file:File):Promise<string>{
    return new Promise((resolve,reject)=>{
      const reader=new FileReader();
      reader.onload=()=>{
        const result=reader.result as string;
        // dataURL is "data:<mime>;base64,<payload>" — strip the header.
        const comma=result.indexOf(',');
        resolve(comma>=0?result.slice(comma+1):result);
      };
      reader.onerror=()=>reject(reader.error);
      reader.readAsDataURL(file);
    });
  }

  /**
   * Memory extraction core. Pulls the latest messages since the last
   * extraction watermark, sends them to /api/ai/memory, saves any
   * returned memories to Brain (one per item), and bumps the watermark.
   *
   * Safe to call repeatedly — no-ops if nothing new or too short.
   */
  async function extractMemoriesFromChat(targetChat:Chat){
    if(extracting)return;
    // Find new messages since the last extraction watermark.
    let startIdx=0;
    if(targetChat.lastExtractedMessageId){
      const i=targetChat.messages.findIndex(m=>m.id===targetChat.lastExtractedMessageId);
      if(i>=0)startIdx=i+1;
    }
    const newMessages=targetChat.messages.slice(startIdx);
    // Need at least 4 messages to bother — anything shorter is noise.
    if(newMessages.length<4)return;

    setExtracting(true);
    try{
      const transcript=newMessages
        .map(m=>`${m.role==='user'?'You':'Roam-io'}: ${m.content||(m.attachments?.length?'[image]':'')}`)
        .join('\n\n');
      const existing=memories.map(m=>m.description).filter(Boolean);
      const res=await fetch('/api/ai/memory',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({transcript,existingMemories:existing}),
      });
      const data=await res.json();
      if(!data.ok||!Array.isArray(data.memories)){
        return;
      }
      const saved:BrainItem[]=[];
      for(const m of data.memories){
        try{
          const item=await saveMemory({description:m.description,content:m.content,tags:m.tags||[]});
          if(item)saved.push(item);
        }catch(e){
          console.error('saveMemory failed',e);
        }
      }
      // Bump watermark on the chat regardless of whether facts were
      // found — we processed those messages and shouldn't reprocess.
      const lastId=targetChat.messages[targetChat.messages.length-1]?.id;
      if(lastId){
        setChats(prev=>prev.map(c=>c.id===targetChat.id?{...c,lastExtractedMessageId:lastId,lastExtractedAt:new Date().toISOString()}:c));
      }
      const duplicates=typeof data.duplicates==='number'?data.duplicates:0;
      if(saved.length>0){
        setMemories(prev=>[...saved,...prev]);
        if(duplicates>0){
          showToast(`${saved.length} new, ${duplicates} duplicate${duplicates===1?'':'s'} skipped`);
        }else{
          showToast(`${saved.length} fact${saved.length===1?'':'s'} saved to memory`);
        }
      }else if(duplicates>0){
        // Nothing new but Claude did find facts — all were duplicates of
        // existing memories. Worth a quiet toast so you know dedupe is working.
        showToast(`${duplicates} duplicate${duplicates===1?'':'s'} skipped`);
      }
    }catch(e){
      console.error('memory extraction error',e);
    }finally{
      setExtracting(false);
    }
  }

  // Trigger A: when the active chat changes (user switches away).
  // Captures the OUTGOING chat in a ref so we can extract from it even
  // after activeChat has flipped.
  const prevActiveIdRef=useRef<string|null>(null);
  useEffect(()=>{
    const prevId=prevActiveIdRef.current;
    if(prevId&&prevId!==activeChat?.id){
      const outgoing=chats.find(c=>c.id===prevId);
      if(outgoing&&outgoing.messages.length>=4){
        extractMemoriesFromChat(outgoing);
      }
    }
    prevActiveIdRef.current=activeChat?.id||null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[activeChat?.id]);

  // Trigger B: idle timer. Each time activeChat's messages change, reset
  // a 2-minute timer; if it fires, extract.
  useEffect(()=>{
    if(!activeChat||activeChat.messages.length<4)return;
    const t=setTimeout(()=>{
      extractMemoriesFromChat(activeChat);
    },2*60*1000);
    return()=>clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[activeChat?.messages.length,activeChat?.id]);

  async function forgetMemory(item:BrainItem){
    try{
      const ok=await deleteItem(item.id);
      if(ok){
        setMemories(prev=>prev.filter(m=>m.id!==item.id));
        setMemoryContents(prev=>{const n={...prev};delete n[item.id];return n;});
        showToast('Memory forgotten');
      }
    }catch(e){
      showToast('Failed to forget');
    }
  }

  /**
   * Smart match: pick memories whose tags or description overlap with the
   * current chat's text. Hard cap at 15 items to keep the system prompt
   * reasonable. Keyword overlap is dumb but fast and good enough for now —
   * upgrade to embeddings if recall starts feeling off.
   */
  function selectRelevantMemories(chatText:string,limit=15):BrainItem[]{
    if(memories.length===0)return[];
    const text=chatText.toLowerCase();
    // Tokenise: words of 4+ chars to skip noise like "the", "and".
    const words=new Set(text.split(/[^a-z0-9-]+/i).filter(w=>w.length>=4));
    if(words.size===0)return memories.slice(0,limit);
    const scored=memories.map(m=>{
      let score=0;
      for(const tag of m.tags){
        if(words.has(tag.toLowerCase()))score+=3;
        // Partial tag match (e.g. "dun-laoghaire" in "laoghaire")
        for(const w of words){
          if(tag.toLowerCase().includes(w)||w.includes(tag.toLowerCase()))score+=1;
        }
      }
      const desc=(m.description||'').toLowerCase();
      for(const w of words){
        if(desc.includes(w))score+=2;
      }
      return{m,score};
    });
    scored.sort((a,b)=>b.score-a.score);
    // Anything scoring 0 only included if we haven't hit the limit yet —
    // helpful when there's no clear match but we want some context.
    return scored.slice(0,limit).map(s=>s.m);
  }

  // Per-message save: bundle ±2 turns of context around the target message.
  async function saveMessageToBrain(msg:Message){
    if(!activeChat||savingMsgId)return;
    setSavingMsgId(msg.id);
    try{
      const idx=activeChat.messages.findIndex(m=>m.id===msg.id);
      const before=activeChat.messages.slice(Math.max(0,idx-2),idx)
        .map(m=>`${m.role==='user'?'You':'Roam-io'}: ${m.content}`).join('\n\n');
      const after=activeChat.messages.slice(idx+1,idx+3)
        .map(m=>`${m.role==='user'?'You':'Roam-io'}: ${m.content}`).join('\n\n');
      const body=`${msg.role==='user'?'You':'Roam-io'}: ${msg.content}`;
      await saveTextToBrain({
        content:body,
        contextBefore:before||undefined,
        contextAfter:after||undefined,
        description:msg.content.split('\n')[0].slice(0,140),
        tags:['roam-io-chat',activeChat.title.toLowerCase().replace(/[^a-z0-9]+/g,'-').slice(0,40)].filter(Boolean),
        source:'roam-io-chat',
      });
      // Mark this message as saved so the bookmark icon flips state.
      updateChat(activeChat.id,activeChat.messages.map(m=>m.id===msg.id?{...m,savedToBrain:true}:m));
      showToast('Saved to Brain');
    }catch(e:any){
      showToast('Save failed: '+(e?.message||'unknown error'));
    }finally{
      setSavingMsgId(null);
    }
  }

  // Full-chat save: one Brain item containing the whole transcript.
  async function saveWholeChatToBrain(){
    if(!activeChat||savingChat||activeChat.messages.length===0)return;
    setSavingChat(true);
    try{
      const transcript=activeChat.messages
        .map(m=>`${m.role==='user'?'You':'Roam-io'}: ${m.content}`)
        .join('\n\n');
      await saveTextToBrain({
        content:transcript,
        description:`Conversation: ${activeChat.title}`,
        tags:['roam-io-chat','conversation',activeChat.title.toLowerCase().replace(/[^a-z0-9]+/g,'-').slice(0,40)].filter(Boolean),
        source:'roam-io-chat',
      });
      showToast('Conversation saved to Brain');
    }catch(e:any){
      showToast('Save failed: '+(e?.message||'unknown error'));
    }finally{
      setSavingChat(false);
    }
  }

  useEffect(()=>{
    let cancelled=false;
    (async()=>{
      const [docsData,chatsData,memoryData]=await Promise.all([
        fetchDocs(),
        loadWithMigration<Chat[]>('hub_chats'),
        fetchMemories().catch(()=>[] as BrainItem[]),
      ]);
      if(cancelled)return;
      setDocs(docsData);
      const hydrated=Array.isArray(chatsData)?chatsData.map((c:any)=>({...c,createdAt:new Date(c.createdAt),updatedAt:new Date(c.updatedAt),messages:(c.messages||[]).map((m:any)=>({...m,timestamp:new Date(m.timestamp)}))})):[];
      setChats(hydrated);
      setMemories(memoryData);
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

  // Toggle pinned state. Pinned chats float into a dedicated section at the
  // top of the sidebar. We deliberately don't bump updatedAt — pinning is
  // an organisational action, not new activity, and we don't want pinning
  // to disrupt the date grouping when the chat is later unpinned.
  function togglePin(id:string,e:React.MouseEvent){
    e.stopPropagation();
    setChats(prev=>prev.map(c=>c.id===id?{...c,pinned:!c.pinned}:c));
  }

  function startRename(c:Chat,e:React.MouseEvent){
    e.stopPropagation();
    setRenamingChatId(c.id);
    setRenameDraft(c.title);
  }

  function commitRename(id:string){
    const next=renameDraft.trim();
    setRenamingChatId(null);
    if(!next)return;// blank → silently cancel
    setChats(prev=>prev.map(c=>c.id===id?{...c,title:next}:c));
    setActiveChat(prev=>prev&&prev.id===id?{...prev,title:next}:prev);
  }

  function cancelRename(){
    setRenamingChatId(null);
    setRenameDraft('');
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
    const rawMsg=(text||input).trim();
    const hasAttachments=pendingAttachments.length>0;
    // Allow send if there's either text OR images. Empty everything stays blocked.
    if((!rawMsg&&!hasAttachments)||loading)return;
    const msg=rawMsg||(hasAttachments?'(image)':'');
    setInput('');

    let chat=activeChat;
    if(!chat){
      chat={id:Date.now().toString(),title:msg.slice(0,40),messages:[],createdAt:new Date(),updatedAt:new Date()};
      setChats(prev=>[chat!,...prev]);setActiveChat(chat);
    }

    setLoading(true);

    // Snapshot attachments so we can clear pending state before the slow
    // upload — UI feels snappier even though the network calls run on.
    const attachmentsToSend=pendingAttachments;
    setPendingAttachments([]);

    // Step 1: upload every image to Brain in parallel. Each gives us a
    // blobId we can reference in chat history. If any single upload fails
    // we still send the others and the text — partial success is OK.
    let attachmentRefs:{blobId:string;mime:string;description?:string}[]=[];
    let visionBlocks:any[]=[];
    if(attachmentsToSend.length>0){
      setUploadingImage(true);
      try{
        const results=await Promise.all(attachmentsToSend.map(async a=>{
          try{
            const [item,b64]=await Promise.all([
              uploadChatImage(a.file),
              fileToBase64(a.file),
            ]);
            return{
              ref:item?{blobId:item.blobId,mime:item.mime,description:item.description}:null,
              base64:b64,
              mime:a.file.type||'image/jpeg',
            };
          }catch(err){
            console.error('image upload failed',err);
            return null;
          }
        }));
        for(const r of results){
          if(!r)continue;
          if(r.ref)attachmentRefs.push(r.ref);
          visionBlocks.push({type:'image',source:{type:'base64',media_type:r.mime,data:r.base64}});
        }
      }finally{
        setUploadingImage(false);
        // Release object URLs we created for previews
        attachmentsToSend.forEach(a=>URL.revokeObjectURL(a.preview));
      }
    }

    const userMsg:Message={
      id:Date.now().toString(),
      role:'user',
      content:msg,
      timestamp:new Date(),
      attachments:attachmentRefs.length>0?attachmentRefs:undefined,
    };
    const title=chat.messages.length===0?msg.slice(0,40)+(msg.length>40?'…':''):chat.title;
    const newMsgs=[...chat.messages,userMsg];
    updateChat(chat.id,newMsgs,title);

    // Build the message list for Claude. Most past turns are plain strings;
    // the current turn becomes a structured content array if we have images.
    const apiMessages:ApiMessage[]=newMsgs.map((m,i)=>{
      const isLast=i===newMsgs.length-1;
      if(isLast&&visionBlocks.length>0){
        return{role:m.role,content:[...visionBlocks,{type:'text',text:m.content}]};
      }
      // For prior turns with attachments, send a text placeholder. We
      // could re-fetch the base64 from Brain to keep vision context across
      // turns, but that's bandwidth-expensive — start lean, revisit if
      // users notice Roam-io "forgetting" earlier images.
      if(m.attachments&&m.attachments.length>0){
        return{role:m.role,content:m.content+` [${m.attachments.length} image${m.attachments.length===1?'':'s'} attached earlier]`};
      }
      return{role:m.role,content:m.content};
    });

    // Build memory context for this turn — keyword-match against the latest user message.
    const latestUserText=newMsgs.filter(m=>m.role==='user').map(m=>m.content).join(' ');
    const relevant=selectRelevantMemories(latestUserText);
    // Resolve cached content for relevant memories, fetching any we haven't seen yet.
    const memBlocks=await Promise.all(relevant.map(async m=>{
      let body=memoryContents[m.id];
      if(!body){
        body=await fetchMemoryContent(m);
        setMemoryContents(prev=>({...prev,[m.id]:body}));
      }
      return `- ${m.description}\n  ${body.split('\n')[0]}`;
    }));
    const memoryContext=memBlocks.length>0?memBlocks.join('\n'):undefined;
    const result=await callRoamio(apiMessages,docs,undefined,memoryContext);
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

    // Memory context for the confirm-reply turn too.
    const latestUserText=history.filter(m=>m.role==='user').map(m=>typeof m.content==='string'?m.content:'').join(' ');
    const relevant=selectRelevantMemories(latestUserText);
    const memBlocks=await Promise.all(relevant.map(async m=>{
      let body=memoryContents[m.id];
      if(!body){
        body=await fetchMemoryContent(m);
        setMemoryContents(prev=>({...prev,[m.id]:body}));
      }
      return `- ${m.description}\n  ${body.split('\n')[0]}`;
    }));
    const memoryContext=memBlocks.length>0?memBlocks.join('\n'):undefined;
    const result=await callRoamio(history,docs,{
      name:pending.name,
      input:pending.input,
      tool_use_id:pending.tool_use_id,
      assistant_content:pending.assistantContent,
    },memoryContext);
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

  // Pinned chats render in their own section; everything else flows through
  // the existing date-bucketing. Pinned order is "newest activity first"
  // (sorted by updatedAt) which mirrors how the date groups already sort.
  const pinnedChats=chats
    .filter(c=>c.pinned)
    .sort((a,b)=>new Date(b.updatedAt).getTime()-new Date(a.updatedAt).getTime());
  const groups=groupChats(chats.filter(c=>!c.pinned));


  async function handleUpload(e:React.ChangeEvent<HTMLInputElement>){
    const file=e.target.files?.[0];if(!file)return;
    e.target.value="";
    try {
      // Upload to the Brain. Documents land in the "Roam-io documents"
      // folder so they're easy to find and so the AI can search/filter to
      // them later via the folder param on search_brain.
      const fd = new FormData();
      fd.append('file', file);
      fd.append('folderName', 'Roam-io documents');
      fd.append('extraTag', 'hub-upload');
      const res = await fetch('/api/brain/items', { method: 'POST', body: fd });
      const data = await res.json();
      if (!data.ok || !data.item) throw new Error(data.error || 'Upload failed');
      const doc:RoamDoc={
        id: data.item.id,
        name: data.item.description || file.name,
        size: file.size,
        content: '',
        uploadedAt: data.item.uploadedAt || new Date().toISOString(),
      };
      setDocs(prev => [doc, ...prev].slice(0, 20));
      const aiMsg:Message={id:(Date.now()+1).toString(),role:"assistant",content:`I have added **${file.name}** (${fmtSize(file.size)}) to your Brain. I will use search_brain to find it when relevant. You can view and download it from the Brain page.`,timestamp:new Date()};
      if(activeChat){updateChat(activeChat.id,[...activeChat.messages,aiMsg]);}
    } catch (err) {
      console.error('Brain upload failed:', err);
      const errMsg:Message={id:(Date.now()+1).toString(),role:"assistant",content:`Sorry — I couldn't upload **${file.name}**. ${err instanceof Error ? err.message : 'Please try again.'}`,timestamp:new Date()};
      if(activeChat){updateChat(activeChat.id,[...activeChat.messages,errMsg]);}
    }
  }

  async function handleDeleteDoc(id:string){
    try {
      await fetch(`/api/brain/items/${id}`, { method: 'DELETE' });
    } catch (err) {
      console.error('Brain delete failed:', err);
    }
    setDocs(prev => prev.filter(d => d.id !== id));
  }

  // Renders a single chat row in the sidebar. Used in both the Pinned
  // section and the date-grouped sections so the look and behaviour
  // (selected state, hover-revealed actions, inline rename) stay
  // identical across both.
  const renderChatRow=(c:Chat)=>{
    const isActive=activeChat?.id===c.id;
    const isRenaming=renamingChatId===c.id;
    const lastMsg=c.messages.length>0?c.messages[c.messages.length-1].content.slice(0,35)+'…':'Empty';
    return (
      <div key={c.id} style={{position:'relative',marginBottom:2}} className="chat-item">
        <button
          onClick={()=>{if(isRenaming)return;setActiveChat(c);setShowChannels(false);}}
          style={{width:'100%',textAlign:'left',padding:'8px 10px',paddingRight:isRenaming?10:74,borderRadius:'var(--r-sm)',background:isActive?'rgba(255,255,255,0.12)':'transparent',border:'none',cursor:isRenaming?'default':'pointer',display:'block'}}
        >
          {isRenaming?(
            <input
              autoFocus
              value={renameDraft}
              onChange={e=>setRenameDraft(e.target.value)}
              onClick={e=>e.stopPropagation()}
              onKeyDown={e=>{
                if(e.key==='Enter'){e.preventDefault();commitRename(c.id);}
                else if(e.key==='Escape'){e.preventDefault();cancelRename();}
              }}
              onBlur={()=>commitRename(c.id)}
              style={{width:'100%',background:'rgba(255,255,255,0.15)',border:'1px solid rgba(255,255,255,0.25)',borderRadius:4,color:'#fff',fontSize:12,padding:'3px 6px',fontFamily:'inherit',outline:'none'}}
            />
          ):(
            <>
              <div style={{display:'flex',alignItems:'center',gap:5,fontSize:12,color:isActive?'#fff':'rgba(255,255,255,0.65)',overflow:'hidden'}}>
                {c.pinned&&<Pin size={9} style={{flexShrink:0,opacity:0.7}}/>}
                <span style={{overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',flex:1,minWidth:0}}>{c.title}</span>
              </div>
              <div style={{fontSize:10,color:'rgba(255,255,255,0.3)',marginTop:2,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{lastMsg}</div>
            </>
          )}
        </button>
        {!isRenaming&&(
          <div className="chat-actions" style={{position:'absolute',right:4,top:'50%',transform:'translateY(-50%)',display:'flex',gap:1,opacity:0,transition:'opacity 0.12s'}}>
            <button
              onClick={(e)=>startRename(c,e)}
              title="Rename conversation"
              className="chat-action-btn"
              style={{background:'none',border:'none',cursor:'pointer',color:'rgba(255,255,255,0.35)',padding:3,display:'flex',alignItems:'center',borderRadius:3}}
            >
              <Pencil size={11}/>
            </button>
            <button
              onClick={(e)=>togglePin(c.id,e)}
              title={c.pinned?'Unpin conversation':'Pin conversation'}
              className="chat-action-btn"
              style={{background:'none',border:'none',cursor:'pointer',color:c.pinned?'rgba(255,200,100,0.85)':'rgba(255,255,255,0.35)',padding:3,display:'flex',alignItems:'center',borderRadius:3,opacity:c.pinned?1:undefined}}
            >
              {c.pinned?<PinOff size={11}/>:<Pin size={11}/>}
            </button>
            <button
              onClick={(e)=>deleteChat(c.id,e)}
              title="Delete conversation"
              className="chat-action-btn delete-btn"
              style={{background:'none',border:'none',cursor:'pointer',color:'rgba(255,255,255,0.35)',padding:3,display:'flex',alignItems:'center',borderRadius:3}}
            >
              <Trash2 size={11}/>
            </button>
          </div>
        )}
      </div>
    );
  };

  const ChannelList=()=>{
    const hasAnyChats=pinnedChats.length>0||groups.length>0;
    return (
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
        {!hasAnyChats&&<div style={{padding:'20px 8px',fontSize:11,color:'rgba(255,255,255,0.3)',textAlign:'center',lineHeight:1.6}}>No conversations yet. Start one above.</div>}
        {pinnedChats.length>0&&(
          <div style={{marginBottom:12}}>
            <div style={{display:'flex',alignItems:'center',gap:5,fontSize:9,letterSpacing:'0.12em',textTransform:'uppercase',color:'rgba(255,200,100,0.55)',padding:'4px 8px',fontWeight:500}}>
              <Pin size={9}/> Pinned
            </div>
            {pinnedChats.map(renderChatRow)}
          </div>
        )}
        {groups.map(g=>(
          <div key={g.label} style={{marginBottom:12}}>
            <div style={{fontSize:9,letterSpacing:'0.12em',textTransform:'uppercase',color:'rgba(255,255,255,0.25)',padding:'4px 8px',fontWeight:500}}>{g.label}</div>
            {g.chats.map(renderChatRow)}
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
  };

  return(
    <div style={{display:'flex',height:'100%',overflow:'hidden',background:'var(--paper)'}}>
      <style>{`@keyframes bounce{0%,60%,100%{transform:translateY(0)}30%{transform:translateY(-5px)}} .chat-item:hover .chat-actions{opacity:1!important;} .chat-action-btn:hover{color:rgba(255,255,255,0.9)!important;background:rgba(255,255,255,0.08);} .chat-item:hover .delete-btn:hover{color:rgba(255,100,100,0.85)!important;} @media (hover:none){.chat-actions{opacity:1!important;}}`}</style>

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
            <div style={{width:'100%',maxWidth:480,marginTop:8,display:'flex',gap:8}}>
              <button onClick={()=>setShowMemories(true)} style={{flex:1,padding:'14px 16px',borderRadius:'var(--r-lg)',border:'1.5px dashed var(--ink-200)',background:'var(--white)',cursor:'pointer',display:'flex',alignItems:'center',gap:10,fontFamily:'inherit'}}>
                <div style={{width:32,height:32,borderRadius:'var(--r-sm)',background:'var(--maroon-50)',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}><Brain size={14} color="var(--maroon-600)"/></div>
                <div style={{textAlign:'left',flex:1,minWidth:0}}>
                  <div style={{fontSize:12,fontWeight:600,color:'var(--ink-900)'}}>Memories</div>
                  <div style={{fontSize:10,color:'var(--ink-400)',marginTop:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{memories.length===0?'Nothing remembered yet':`${memories.length} fact${memories.length===1?'':'s'} remembered`}</div>
                </div>
              </button>
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
            {activeChat.messages.length>0&&(
              <div style={{display:'flex',justifyContent:'flex-end',marginBottom:-6}}>
                <button
                  onClick={saveWholeChatToBrain}
                  disabled={savingChat}
                  title="Save the whole conversation to Brain"
                  style={{display:'inline-flex',alignItems:'center',gap:5,fontSize:11,padding:'5px 10px',borderRadius:'var(--r-pill)',border:'1px solid var(--ink-200)',background:'var(--white)',cursor:savingChat?'default':'pointer',color:'var(--ink-600)',fontFamily:'inherit',opacity:savingChat?0.5:1}}
                >
                  {savingChat?<>Saving conversation…</>:<><Bookmark size={11}/> Save conversation</>}
                </button>
              </div>
            )}
            {activeChat.messages.map(m=>(
              <div key={m.id} style={{display:'flex',flexDirection:m.role==='user'?'row-reverse':'row',gap:10,alignItems:'flex-start'}}>
                {m.role==='assistant'&&<div style={{width:26,height:26,borderRadius:'50%',background:'var(--maroon-50)',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0,marginTop:2,fontSize:12}}>🦁</div>}
                <div style={{maxWidth:'85%'}}>
                  <div style={{fontSize:10,color:'var(--ink-400)',marginBottom:4,textAlign:m.role==='user'?'right':'left'}}>{m.role==='user'?'You':'Roam-io'} · {new Date(m.timestamp).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'})}</div>
                  {m.attachments&&m.attachments.length>0&&(
                    <div style={{display:'flex',gap:6,flexWrap:'wrap',marginBottom:6,justifyContent:m.role==='user'?'flex-end':'flex-start'}}>
                      {m.attachments.map((a,i)=>(
                        <a key={i} href={`/api/images/${a.blobId}`} target="_blank" rel="noreferrer" style={{display:'block',width:120,height:120,borderRadius:'var(--r-md)',overflow:'hidden',border:'1px solid var(--ink-200)',background:'var(--paper)'}}>
                          <img src={`/api/images/${a.blobId}`} alt={a.description||'attachment'} style={{width:'100%',height:'100%',objectFit:'cover'}}/>
                        </a>
                      ))}
                    </div>
                  )}
                  <div style={{background:m.role==='user'?'var(--maroon-50)':'var(--paper)',borderRadius:m.role==='user'?'var(--r-lg) 0 var(--r-lg) var(--r-lg)':'0 var(--r-lg) var(--r-lg) var(--r-lg)',padding:'11px 14px',fontSize:13,color:'var(--ink-900)',lineHeight:1.7,whiteSpace:'pre-wrap',display:m.content==='(image)'?'none':'block'}}>{m.content}</div>
                  {m.content&&!m.pendingTool&&(
                    <div style={{marginTop:4,display:'flex',justifyContent:m.role==='user'?'flex-end':'flex-start'}}>
                      <button
                        onClick={()=>saveMessageToBrain(m)}
                        disabled={savingMsgId===m.id||m.savedToBrain}
                        title={m.savedToBrain?'Saved to Brain':'Save to Brain'}
                        style={{background:'none',border:'none',padding:'4px 6px',cursor:m.savedToBrain?'default':'pointer',display:'flex',alignItems:'center',gap:4,fontSize:10,color:m.savedToBrain?'var(--ok)':'var(--ink-400)',borderRadius:'var(--r-xs)',fontFamily:'inherit',opacity:savingMsgId===m.id?0.5:1}}
                      >
                        {m.savedToBrain?<><BookmarkCheck size={11}/> Saved</>:savingMsgId===m.id?<>Saving…</>:<><Bookmark size={11}/> Save to Brain</>}
                      </button>
                    </div>
                  )}
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
          {pendingAttachments.length>0&&(
            <div style={{display:'flex',gap:6,flexWrap:'wrap',marginBottom:8}}>
              {pendingAttachments.map((a,i)=>(
                <div key={i} style={{position:'relative',width:64,height:64,borderRadius:'var(--r-sm)',overflow:'hidden',border:'1px solid var(--ink-200)'}}>
                  <img src={a.preview} alt="" style={{width:'100%',height:'100%',objectFit:'cover'}}/>
                  <button onClick={()=>removePendingAttachment(i)} title="Remove" style={{position:'absolute',top:2,right:2,width:18,height:18,borderRadius:'50%',background:'rgba(0,0,0,0.7)',color:'white',border:'none',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',padding:0}}><X size={11}/></button>
                </div>
              ))}
              {uploadingImage&&<div style={{display:'flex',alignItems:'center',fontSize:11,color:'var(--ink-500)',padding:'0 8px'}}>Uploading…</div>}
            </div>
          )}
          <div style={{display:'flex',gap:8,alignItems:'flex-end',position:'relative'}}>
            <input ref={fileInputRef} type="file" accept=".txt,.pdf,.csv,.md" onChange={handleUpload} style={{display:"none"}}/>
            <input ref={imageInputRef} type="file" accept="image/*" multiple onChange={handleImagePicked} style={{display:"none"}}/>
            <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" onChange={handleImagePicked} style={{display:"none"}}/>
            <textarea ref={inputRef} value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send();}}} placeholder={activeChat?'Continue the conversation… (Enter to send)':'Ask Roam-io anything…'} rows={2} disabled={loading} style={{flex:1,fontSize:13,padding:'9px 12px',border:'1.5px solid var(--ink-200)',borderRadius:'var(--r-md)',fontFamily:'inherit',color:'var(--ink-900)',background:'var(--white)',resize:'none',outline:'none'}}/>
            <button onClick={()=>setShowAttachMenu(v=>!v)} title="Attach" style={{width:40,height:40,borderRadius:"var(--r-md)",background:showAttachMenu?'var(--maroon-700)':"var(--ink-100)",border:"none",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}><Paperclip size={15} color={showAttachMenu?'white':"var(--ink-500)"}/></button>
            <button onClick={()=>send()} disabled={(!input.trim()&&pendingAttachments.length===0)||loading} style={{width:40,height:40,borderRadius:'var(--r-md)',background:(input.trim()||pendingAttachments.length>0)&&!loading?'var(--maroon-700)':'var(--ink-200)',border:'none',cursor:(input.trim()||pendingAttachments.length>0)&&!loading?'pointer':'default',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0,transition:'background 0.15s'}}>
              <Send size={15} color="white"/>
            </button>
            {showAttachMenu&&(
              <>
                <div onClick={()=>setShowAttachMenu(false)} style={{position:'fixed',inset:0,zIndex:200}}/>
                <div style={{position:'absolute',bottom:48,right:48,background:'var(--white)',borderRadius:'var(--r-md)',boxShadow:'var(--shadow-lg)',border:'1px solid var(--ink-100)',padding:6,minWidth:200,zIndex:201}}>
                  {isMobile?(
                    <>
                      <button onClick={()=>{cameraInputRef.current?.click();}} style={{display:'flex',alignItems:'center',gap:10,width:'100%',padding:'10px 12px',background:'none',border:'none',cursor:'pointer',fontSize:12,color:'var(--ink-700)',borderRadius:'var(--r-sm)',fontFamily:'inherit',textAlign:'left'}}>
                        <Camera size={14} color="var(--maroon-600)"/> Take a photo
                      </button>
                      <button onClick={()=>{imageInputRef.current?.click();}} style={{display:'flex',alignItems:'center',gap:10,width:'100%',padding:'10px 12px',background:'none',border:'none',cursor:'pointer',fontSize:12,color:'var(--ink-700)',borderRadius:'var(--r-sm)',fontFamily:'inherit',textAlign:'left'}}>
                        <ImageIcon size={14} color="var(--maroon-600)"/> Choose from library
                      </button>
                    </>
                  ):(
                    <button onClick={()=>{imageInputRef.current?.click();}} style={{display:'flex',alignItems:'center',gap:10,width:'100%',padding:'10px 12px',background:'none',border:'none',cursor:'pointer',fontSize:12,color:'var(--ink-700)',borderRadius:'var(--r-sm)',fontFamily:'inherit',textAlign:'left'}}>
                      <ImageIcon size={14} color="var(--maroon-600)"/> Attach image
                    </button>
                  )}
                  <div style={{height:1,background:'var(--ink-100)',margin:'4px 0'}}/>
                  <button onClick={()=>{setShowAttachMenu(false);fileInputRef.current?.click();}} style={{display:'flex',alignItems:'center',gap:10,width:'100%',padding:'10px 12px',background:'none',border:'none',cursor:'pointer',fontSize:12,color:'var(--ink-700)',borderRadius:'var(--r-sm)',fontFamily:'inherit',textAlign:'left'}}>
                    <FileText size={14} color="var(--info)"/> Add to knowledge base
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
      {toast&&(
        <div style={{position:'fixed',bottom:24,left:'50%',transform:'translateX(-50%)',background:'var(--ink-900)',color:'white',padding:'10px 18px',borderRadius:'var(--r-pill)',fontSize:12,fontWeight:500,boxShadow:'var(--shadow-lg)',zIndex:1000,display:'flex',alignItems:'center',gap:8}}>
          <Check size={13}/>{toast}
        </div>
      )}
      {showMemories&&(
        <div style={{position:'fixed',inset:0,background:'rgba(26,13,18,0.5)',zIndex:500,display:'flex',alignItems:'center',justifyContent:'center'}} onClick={e=>{if(e.target===e.currentTarget)setShowMemories(false);}}>
          <div style={{background:'var(--white)',borderRadius:'var(--r-xl)',width:560,maxWidth:'95vw',maxHeight:'85vh',display:'flex',flexDirection:'column',boxShadow:'var(--shadow-lg)'}}>
            <div style={{padding:'18px 22px 14px',borderBottom:'1px solid var(--ink-100)',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
              <div>
                <div style={{fontFamily:'var(--font-display)',fontSize:20,color:'var(--ink-900)'}}>Memories</div>
                <div style={{fontSize:11,color:'var(--ink-400)',marginTop:2}}>What Roam-io has learned about you and your work across conversations</div>
              </div>
              <button onClick={()=>setShowMemories(false)} style={{width:28,height:28,borderRadius:'var(--r-sm)',border:'1.5px solid var(--ink-200)',background:'var(--white)',display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer',padding:0}}><X size={14}/></button>
            </div>
            <div style={{padding:16,overflowY:'auto',flex:1}}>
              {memories.length===0?(
                <div style={{padding:'40px 20px',textAlign:'center'}}>
                  <Brain size={32} color="var(--ink-200)" style={{margin:'0 auto 12px',display:'block'}}/>
                  <div style={{fontSize:14,color:'var(--ink-600)',marginBottom:6}}>Nothing remembered yet</div>
                  <div style={{fontSize:11,color:'var(--ink-400)',lineHeight:1.6,maxWidth:340,margin:'0 auto'}}>Roam-io will save durable facts (contacts, decisions, active projects) automatically as you chat. You can also save anything manually via the bookmark on each message.</div>
                </div>
              ):(
                <div style={{display:'flex',flexDirection:'column',gap:8}}>
                  {memories.map(m=>(
                    <div key={m.id} style={{padding:'12px 14px',borderRadius:'var(--r-md)',background:'var(--paper)',border:'1px solid var(--ink-100)',display:'flex',gap:10,alignItems:'flex-start'}}>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{fontSize:13,color:'var(--ink-900)',lineHeight:1.5,marginBottom:6}}>{m.description||<em style={{color:'var(--ink-400)'}}>No description</em>}</div>
                        <div style={{display:'flex',gap:4,flexWrap:'wrap'}}>
                          {m.tags.filter(t=>t!=='roam-io-memory'&&t!=='roam-io-chat').slice(0,5).map(t=>(
                            <span key={t} style={{fontSize:9,background:'var(--white)',padding:'2px 7px',borderRadius:'var(--r-pill)',color:'var(--ink-500)',border:'1px solid var(--ink-100)'}}>{t}</span>
                          ))}
                          <span style={{fontSize:9,color:'var(--ink-400)',padding:'2px 0'}}>{new Date(m.uploadedAt).toLocaleDateString('en-GB',{day:'numeric',month:'short'})}</span>
                        </div>
                      </div>
                      <button onClick={()=>forgetMemory(m)} title="Forget this" style={{width:26,height:26,borderRadius:'var(--r-xs)',border:'1.5px solid var(--ink-200)',background:'var(--white)',display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer',color:'var(--alert)',flexShrink:0}}><Trash2 size={12}/></button>
                    </div>
                  ))}
                </div>
              )}
            </div>
            {extracting&&(
              <div style={{padding:'10px 22px',borderTop:'1px solid var(--ink-100)',fontSize:11,color:'var(--ink-500)',display:'flex',alignItems:'center',gap:8}}>
                <Sparkles size={12} color="var(--maroon-600)"/> Looking for new memories…
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
