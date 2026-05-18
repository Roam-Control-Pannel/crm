'use client';
import {useState,useEffect,useCallback} from "react";
import {Send,Plus,Pencil,X,Mail,Clock,CheckCircle,AlertCircle,Info,Star,MessageSquare,UserPlus,Search,RotateCcw} from 'lucide-react';
import {BrevoListSelector} from '@/components/BrevoListSelector';
import {addNotification} from "@/components/NotificationCentre";

interface Contact {id:number;email:string;attributes:Record<string,string>;listIds?:number[];}
interface BrevoList {id:number;name:string;uniqueSubscribers:number;}
interface TimelineEvent {id:string;type:string;title:string;body?:string;user?:string;timestamp?:Date;meta?:Record<string,string>;}
interface StoredReply {
  uid:number;fromEmail:string;fromName:string|null;subject:string;
  bodyText:string;bodyTextRaw:string;receivedAt:string;
  isAutoResponder:boolean;storedAt:string;
}

const sColors:Record<string,string>={not_contacted:'var(--ink-300)',email_sent:'var(--warn)',followed_up:'var(--warn)',responded:'var(--info)',listed:'var(--ok)',cold:'var(--alert)'};
const sLabels:Record<string,string>={not_contacted:'Not contacted',email_sent:'Email sent',followed_up:'Followed up',responded:'Responded',listed:'Listed ✓',cold:'Cold'};
const srcColors:Record<string,{bg:string;color:string}>={google:{bg:'#e4f0fb',color:'var(--info)'},yell:{bg:'#fdf0e4',color:'var(--warn)'},manual:{bg:'var(--ink-100)',color:'var(--ink-500)'}};

function uniqueTowns(contacts:Contact[]):string[]{const seen:Record<string,boolean>={};const out:string[]=[];contacts.forEach(c=>{const t=c.attributes?.TOWN;if(t&&!seen[t]){seen[t]=true;out.push(t);}});return out.sort();}
function getInitials(name:string):string{return name.split(' ').map((w:string)=>w[0]).join('').slice(0,2).toUpperCase();}
function timeAgo(d:Date):string{const s=Math.floor((Date.now()-d.getTime())/1000);if(s<60)return 'just now';if(s<3600)return Math.floor(s/60)+'m ago';if(s<86400)return Math.floor(s/3600)+'h ago';return Math.floor(s/86400)+'d ago';}

// Brevo's date attrs (LAST_OPENED_AT etc.) come back as ISO strings when
// set, empty string when cleared. Empty/missing parses to NaN — guard for
// it so we don't render "Invalid Date" tiles.
function parseAttrDate(v:string|undefined):Date|null{
  if(!v)return null;
  const t=Date.parse(v);
  return Number.isNaN(t)?null:new Date(t);
}

function buildTimeline(contact:Contact,replies:StoredReply[]=[]):TimelineEvent[]{
  const events:TimelineEvent[]=[];const attrs=contact.attributes||{};

  // Engagement events sourced from real Brevo attributes (set by the
  // /api/brevo/webhook handler on opened/click events). These cross-cut
  // OUTREACH_STATUS — a contact can be opened/clicked even though we've
  // never updated their stage (e.g. status was reset, or they opened a
  // one-off send that didn't move them through the sequence). Driving the
  // timeline off OUTREACH_STATUS alone meant the engagement notification
  // ("X opened your email") would fire but the panel would show 0 opens.
  const openedAt=parseAttrDate(attrs.LAST_OPENED_AT);
  const openCount=Number(attrs.OPEN_COUNT||0);
  if(openedAt&&openCount>0){
    events.push({
      id:'opened',
      type:'email_opened',
      title:openCount===1?'Email opened':`Email opened × ${openCount}`,
      body:openCount>=3?'Strong engagement signal':'They are reading.',
      timestamp:openedAt,
    });
  }
  const clickedAt=parseAttrDate(attrs.LAST_CLICKED_AT);
  const clickCount=Number(attrs.CLICK_COUNT||0);
  if(clickedAt&&clickCount>0){
    events.push({
      id:'clicked',
      type:'email_opened', // reuse opened styling until we add a dedicated click icon
      title:clickCount===1?'Link clicked — hot lead':`Link clicked × ${clickCount} — hot lead`,
      body:'Follow up while interest is fresh.',
      timestamp:clickedAt,
    });
  }
  // Bounce/unsubscribe visibility — same reasoning: the webhook stamps
  // these attrs but the timeline previously had no way to surface them.
  const bouncedAt=parseAttrDate(attrs.BOUNCED_AT);
  if(bouncedAt){
    events.push({id:'bounced',type:'bounced',title:`Email ${attrs.BOUNCE_TYPE||'hard'}-bounced`,body:'Address rejected by recipient server.',timestamp:bouncedAt});
  }
  const unsubAt=parseAttrDate(attrs.UNSUBSCRIBED_AT);
  if(unsubAt){
    events.push({id:'unsub',type:'unsub',title:'Unsubscribed',body:'No further emails will be sent.',timestamp:unsubAt});
  }

  const deliveredAt=parseAttrDate(attrs.LAST_DELIVERED_AT);
  const lastContactDate=parseAttrDate(attrs.LAST_CONTACT_DATE);
  const realSentAt=deliveredAt||lastContactDate;
  if(realSentAt){
    events.push({id:'email-real',type:'email_sent',title:'Email sent via Brevo',body:deliveredAt?'Delivered to recipient.':'Send recorded.',timestamp:realSentAt});
  }
  for(const r of replies){
    const truncated=r.bodyText.length>200;
    events.push({
      id:`reply-${r.uid}`,
      type:r.isAutoResponder?'auto_reply':'reply',
      title:r.isAutoResponder?'Auto-reply received':'Reply received',
      body:truncated?r.bodyText.slice(0,200)+'…':r.bodyText,
      timestamp:new Date(r.receivedAt),
      meta:{
        subject:r.subject,
        classification:r.isAutoResponder?'Auto-responder':'Real reply',
        ...(truncated?{fullBody:r.bodyText}:{}),
      },
    });
  }
  if(attrs.NOTES){events.push({id:'note',type:'note',title:'Note added',body:attrs.NOTES,user:'Roam Local'});}
  return events.reverse();
}

function getAiScore(contact:Contact):number{
  const attrs=contact.attributes||{};let score=5;
  const type=(attrs.BUSINESS_TYPE||'').toLowerCase();
  if(type.includes('restaurant')||type.includes('pub')||type.includes('café')||type.includes('cafe'))score+=2;
  if(attrs.WEBSITE)score+=1;if(attrs.PHONE)score+=0.5;
  if(['responded','listed'].includes(attrs.OUTREACH_STATUS||''))score+=2;
  if(attrs.SOURCE==='google')score+=0.5;
  return Math.min(10,Math.round(score));
}

function getSuggestedAction(contact:Contact):{title:string;body:string}|null{
  const st=contact.attributes?.OUTREACH_STATUS||'not_contacted';
  if(st==='not_contacted')return{title:'Send first outreach',body:'AI can personalise the opening line'};
  if(st==='email_sent')return{title:'Send follow-up — no reply yet',body:'Step 1 was sent. Time to follow up.'};
  if(st==='responded')return{title:'They replied — draft ready',body:'AI has prepared a response'};
  if(st==='followed_up')return{title:'Send final nudge',body:'Last attempt before marking cold'};
  return null;
}

function tileColor(type:string):string{
  if(type==='created')return'#e8f0fb';if(type==='email_sent')return'#fbeaef';
  if(type==='email_opened')return'#fdf0e4';if(type==='reply')return'#e8f5ee';
  if(type==='auto_reply')return'#ececec';
  if(type==='enriched')return'#fde9c3';return'var(--ink-100)';
}

function TimelineIcon({type}:{type:string}){
  const p={size:12};
  if(type==='created')return<UserPlus {...p} color="var(--info)"/>;
  if(type==='email_sent')return<Mail {...p} color="var(--maroon-600)"/>;
  if(type==='email_opened')return<Clock {...p} color="var(--warn)"/>;
  if(type==='reply')return<MessageSquare {...p} color="var(--ok)"/>;
  if(type==='auto_reply')return<MessageSquare {...p} color="var(--ink-400)"/>;
  if(type==='note')return<Pencil {...p} color="var(--ink-500)"/>;
  if(type==='enriched')return<Star {...p} color="var(--warn)"/>;
  return<CheckCircle {...p} color="var(--ink-400)"/>;
}

function ContactPanel({contact,onClose,onSend,onReset}:{contact:Contact;onClose:()=>void;onSend:(c:Contact)=>void;onReset:(c:Contact)=>void;}){
  const attrs=contact.attributes||{};
  const nm=attrs.BUSINESS_NAME||attrs.FIRSTNAME||contact.email||'Unknown';
  const [replies,setReplies]=useState<StoredReply[]>([]);
  const [expandedEvents,setExpandedEvents]=useState<Set<string>>(new Set());
  const toggleEvent=(id:string)=>setExpandedEvents(p=>{const n=new Set(p);n.has(id)?n.delete(id):n.add(id);return n;});
  // Fetch real replies for this contact when the panel opens. On failure
  // or empty response, the timeline still renders with whatever
  // Brevo-attribute events apply (opens/clicks/bounces/etc.).
  useEffect(()=>{
    let cancelled=false;
    fetch(`/api/replies?email=${encodeURIComponent(contact.email)}`,{cache:'no-store'})
      .then(r=>r.ok?r.json():{replies:[]})
      .then((data:{replies?:StoredReply[]})=>{
        if(!cancelled&&Array.isArray(data.replies))setReplies(data.replies);
      })
      .catch(err=>console.error('fetch replies failed:',err));
    return ()=>{cancelled=true;};
  },[contact.email]);
  const timeline=buildTimeline(contact,replies);
  const aiScore=getAiScore(contact);
  const suggested=getSuggestedAction(contact);
  const [note,setNote]=useState('');
  const [saving,setSaving]=useState(false);
  const st=attrs.OUTREACH_STATUS||'not_contacted';

  async function saveNote(){
    if(!note.trim())return;setSaving(true);
    await fetch('/api/brevo/contacts',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:contact.email,NOTES:note.trim()})});
    addNotification({type:'info',title:'Note saved',body:`Note added to ${nm}`});
    setSaving(false);setNote('');
  }

  return(
    <>
      <div onClick={onClose} style={{position:'fixed',inset:0,background:'rgba(26,13,18,0.45)',zIndex:200}}/>
      {/* contact-panel class adds height: 100dvh on top of the inline
          100vh fallback — iOS Safari's URL bar otherwise hides the
          footer's Send email button (the layout viewport top:0+bottom:0
          would use refers to the larger viewport with URL bar collapsed). */}
      <div className="contact-panel" style={{position:'fixed',top:0,right:0,height:'100vh',width:'min(440px,100vw)',background:'var(--white)',zIndex:201,display:'flex',flexDirection:'column',boxShadow:'-4px 0 24px rgba(26,18,19,0.15)',animation:'slideInRight 0.22s cubic-bezier(0.4,0,0.2,1)'}}>

        {/* Header */}
        <div style={{padding:'14px 16px',borderBottom:'1px solid var(--ink-100)',display:'flex',alignItems:'center',gap:10,flexShrink:0}}>
          <div style={{width:38,height:38,borderRadius:'50%',background:'var(--maroon-50)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:13,fontWeight:600,color:'var(--maroon-600)',flexShrink:0}}>{getInitials(nm)}</div>
          <div style={{flex:1,minWidth:0}}>
            <div style={{fontSize:14,fontWeight:600,color:'var(--ink-900)',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{nm}</div>
            <div style={{fontSize:11,color:'var(--ink-400)'}}>{attrs.BUSINESS_TYPE||'Business'}{attrs.TOWN?` · ${attrs.TOWN}`:''}</div>
          </div>
          <span style={{padding:'3px 9px',borderRadius:'var(--r-pill)',fontSize:10,fontWeight:600,background:'var(--ink-100)',color:sColors[st]||'var(--ink-300)',flexShrink:0,whiteSpace:'nowrap'}}>{sLabels[st]||st}</span>
          <button onClick={onClose} style={{width:28,height:28,borderRadius:'var(--r-xs)',border:'1.5px solid var(--ink-200)',background:'var(--white)',display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer',flexShrink:0}}><X size={14} color="var(--ink-500)"/></button>
        </div>

        {/* Stats — Opens/Replies are sourced from Brevo attrs (set by the
            webhook). Sent is derived from the timeline since we don't have
            a dedicated SENT_COUNT attribute; the timeline now includes a
            real send event when LAST_DELIVERED_AT/LAST_CONTACT_DATE exist,
            so this stays accurate when OUTREACH_STATUS hasn't been moved. */}
        <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',borderBottom:'1px solid var(--ink-100)',flexShrink:0}}>
          {[{label:'Sent',value:timeline.filter(e=>e.type==='email_sent').length,color:'var(--maroon-600)'},{label:'Opens',value:Number(attrs.OPEN_COUNT||0),color:'var(--info)'},{label:'Replies',value:timeline.filter(e=>e.type==='reply'||e.type==='auto_reply').length,color:'var(--ok)'},{label:'AI',value:aiScore,color:'var(--maroon-500)'}].map((s,i)=>(
            <div key={s.label} style={{padding:'10px 8px',textAlign:'center',borderRight:i<3?'1px solid var(--ink-100)':'none'}}>
              <div style={{fontSize:20,fontFamily:'var(--font-display)',color:s.color,lineHeight:1}}>{s.value}</div>
              <div style={{fontSize:10,color:'var(--ink-400)',textTransform:'uppercase',letterSpacing:'0.06em',marginTop:2}}>{s.label}</div>
            </div>
          ))}
        </div>

        {/* AI banner */}
        {suggested&&(
          <div style={{padding:'10px 14px',background:'#e8f5ee',borderBottom:'1px solid var(--ink-100)',display:'flex',alignItems:'center',gap:10,flexShrink:0}}>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontSize:12,fontWeight:600,color:'var(--ok)',marginBottom:2}}>{suggested.title}</div>
              <div style={{fontSize:11,color:'var(--ink-600)'}}>{suggested.body}</div>
            </div>
            <button onClick={()=>onSend(contact)} style={{fontSize:11,padding:'5px 12px',background:'var(--maroon-700)',color:'white',border:'none',borderRadius:'var(--r-sm)',cursor:'pointer',whiteSpace:'nowrap',flexShrink:0}}>Send now</button>
          </div>
        )}

        {/* Scrollable body */}
        <div style={{flex:1,overflowY:'auto',padding:'0 16px'}}>

          {/* Contact details */}
          <div style={{padding:'12px 0',borderBottom:'1px solid var(--ink-100)'}}>
            <div style={{fontSize:10,fontWeight:600,textTransform:'uppercase',letterSpacing:'0.08em',color:'var(--ink-400)',marginBottom:8}}>Contact details</div>
            {[{label:'Email',value:contact.email,color:'var(--info)'},{label:'Phone',value:attrs.PHONE||'—'},{label:'Website',value:attrs.WEBSITE||'—',color:attrs.WEBSITE?'var(--info)':undefined},{label:'Source',value:attrs.SOURCE||'manual'}].map(r=>(
              <div key={r.label} style={{display:'flex',justifyContent:'space-between',fontSize:12,marginBottom:6}}>
                <span style={{color:'var(--ink-400)'}}>{r.label}</span>
                <span style={{color:r.color||'var(--ink-800)',fontWeight:500,maxWidth:'60%',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{r.value}</span>
              </div>
            ))}
          </div>

          {/* AI score */}
          <div style={{padding:'12px 0',borderBottom:'1px solid var(--ink-100)',display:'flex',alignItems:'center',gap:10}}>
            <div style={{width:34,height:34,borderRadius:'50%',border:'2px solid var(--maroon-500)',background:'var(--maroon-50)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:15,fontFamily:'var(--font-display)',color:'var(--maroon-700)',flexShrink:0}}>{aiScore}</div>
            <div style={{fontSize:11,color:'var(--ink-500)',lineHeight:1.5}}>AI score — {aiScore>=8?'high':aiScore>=6?'medium':'lower'} likelihood to list on Roam{attrs.BUSINESS_TYPE?`. ${attrs.BUSINESS_TYPE}.`:''}</div>
          </div>

          {/* Timeline */}
          <div style={{padding:'12px 0'}}>
            <div style={{fontSize:10,fontWeight:600,textTransform:'uppercase',letterSpacing:'0.08em',color:'var(--ink-400)',marginBottom:10}}>Activity timeline</div>
            {timeline.map((ev,i)=>(
              <div key={ev.id} style={{display:'flex',gap:10,paddingBottom:i<timeline.length-1?12:0}}>
                <div style={{display:'flex',flexDirection:'column',alignItems:'center',flexShrink:0}}>
                  <div style={{width:26,height:26,borderRadius:'50%',background:tileColor(ev.type),display:'flex',alignItems:'center',justifyContent:'center'}}><TimelineIcon type={ev.type}/></div>
                  {i<timeline.length-1&&<div style={{width:1,flex:1,background:'var(--ink-200)',margin:'4px 0',minHeight:8}}/>}
                </div>
                <div style={{flex:1,minWidth:0,paddingTop:4}}>
                  <div style={{display:'flex',justifyContent:'space-between',gap:6,marginBottom:3}}>
                    <span style={{fontSize:12,fontWeight:600,color:'var(--ink-900)'}}>{ev.title}</span>
                    {ev.timestamp&&<span style={{fontSize:10,color:'var(--ink-400)',flexShrink:0}}>{timeAgo(ev.timestamp)}</span>}
                  </div>
                  {ev.body&&(()=>{
                    const isExpandable=!!ev.meta?.fullBody;
                    const isExpanded=expandedEvents.has(ev.id);
                    const shown=isExpandable&&isExpanded?ev.meta!.fullBody:ev.body;
                    return (
                      <div style={{fontSize:11,color:'var(--ink-600)',lineHeight:1.5,fontStyle:ev.type==='reply'||ev.type==='auto_reply'||ev.type==='note'?'italic':undefined,background:ev.type==='reply'||ev.type==='auto_reply'||ev.type==='note'?'var(--paper)':undefined,borderRadius:'var(--r-sm)',padding:ev.type==='reply'||ev.type==='auto_reply'||ev.type==='note'?'6px 8px':undefined,whiteSpace:isExpanded?'pre-wrap':undefined}}>
                        {shown}
                        {isExpandable&&(<>{' '}<button type="button" onClick={(e)=>{e.preventDefault();e.stopPropagation();toggleEvent(ev.id);}} style={{background:'none',border:'none',padding:0,color:'var(--maroon-700)',fontSize:11,fontWeight:600,fontStyle:'normal',cursor:'pointer',textDecoration:'underline'}}>{isExpanded?'show less':'show more'}</button></>)}
                      </div>
                    );
                  })()}
                  {ev.meta?.classification&&<span style={{display:'inline-flex',marginTop:4,fontSize:10,padding:'2px 7px',borderRadius:'var(--r-pill)',background:'#e8f5ee',color:'var(--ok)',fontWeight:600}}>AI: {ev.meta.classification}</span>}
                  {ev.meta?.personalised&&<span style={{display:'inline-flex',marginTop:4,fontSize:10,padding:'2px 7px',borderRadius:'var(--r-pill)',background:'var(--maroon-50)',color:'var(--maroon-600)',fontWeight:600}}>AI personalised</span>}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div style={{borderTop:'1px solid var(--ink-100)',padding:'12px 16px',flexShrink:0}}>
          <textarea value={note} onChange={e=>setNote(e.target.value)} placeholder="Add a team note…" rows={2} style={{width:'100%',fontSize:12,padding:'8px 10px',border:'1.5px solid var(--ink-200)',borderRadius:'var(--r-md)',background:'var(--paper)',color:'var(--ink-900)',resize:'none',outline:'none',fontFamily:'inherit',marginBottom:8,boxSizing:'border-box'}}/>
          <div style={{display:'flex',gap:8}}>
            <button onClick={saveNote} disabled={saving||!note.trim()} style={{flex:1,fontSize:11,padding:'7px 0',borderRadius:'var(--r-sm)',border:'1.5px solid var(--ink-200)',background:'var(--white)',cursor:'pointer',opacity:saving||!note.trim()?0.5:1}}>{saving?'Saving…':'Add note'}</button>
            <button onClick={()=>onSend(contact)} style={{flex:2,fontSize:11,padding:'7px 0',borderRadius:'var(--r-sm)',border:'none',background:'var(--maroon-700)',color:'white',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',gap:6}}><Send size={12}/> Send email</button>
          </div>
          {/* Reset status — only useful when there's something to reset. Keeps
              UI uncluttered when the contact is already at 'not_contacted'.
              Engagement attributes (LAST_OPENED_AT, OPEN_COUNT etc.) stay
              intact \u2014 those are real facts about what the contact did and
              shouldn't be erased. We only clear OUTREACH_STATUS and
              LAST_CONTACT_DATE so the cron will pick them up again. */}
          {st!=='not_contacted'&&(
            <button onClick={()=>onReset(contact)} style={{marginTop:8,width:'100%',fontSize:10.5,padding:'6px 0',borderRadius:'var(--r-sm)',border:'1px solid var(--ink-200)',background:'var(--white)',color:'var(--ink-500)',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',gap:6,fontWeight:600}}>
              <RotateCcw size={11}/> Reset status to Not Contacted
            </button>
          )}
        </div>
      </div>
    </>
  );
}

export default function ContactsPage(){
  const [contacts,setContacts]=useState<Contact[]>([]);
  const [lists,setLists]=useState<BrevoList[]>([]);
  const [loading,setLoading]=useState(true);
  const [search,setSearch]=useState('');
  const [townFilter,setTownFilter]=useState('');
  const [stageFilter,setStageFilter]=useState('');

  // Read query params (?stage=...&search=...) once on mount so dashboard
  // funnel links and notification deep-links can scope the contacts view.
  useEffect(()=>{
    if(typeof window==='undefined')return;
    const params=new URLSearchParams(window.location.search);
    const stage=params.get('stage');
    const sQuery=params.get('search');
    if(stage)setStageFilter(stage);
    if(sQuery)setSearch(sQuery);
  },[]);
  const [listFilter,setListFilter]=useState('');
  const [showModal,setShowModal]=useState(false);
  const [showCreateList,setShowCreateList]=useState(false);
  const [newListName,setNewListName]=useState('');
  const [creatingList,setCreatingList]=useState(false);
  const [saving,setSaving]=useState(false);
  const [queueing,setQueueing]=useState<number|null>(null);
  const [queued,setQueued]=useState<number[]>([]);
  const [toast,setToast]=useState<string|null>(null);
  const [selectedContact,setSelectedContact]=useState<Contact|null>(null);
  const [form,setForm]=useState({name:'',email:'',town:'',type:'Restaurant',website:'',phone:'',source:'manual',status:'not_contacted',notes:'',listId:''});

  const loadContacts=useCallback(async(listId?:string)=>{
    setLoading(true);
    const url=listId?`/api/brevo/contacts?limit=500&listId=${listId}`:`/api/brevo/contacts?limit=500`;
    try{
      const d=await fetch(url,{cache:'no-store'}).then(r=>r.json());
      setContacts(d.contacts||[]);
    }catch{
      setContacts([]);
    }finally{
      setLoading(false);
    }
  },[]);

  useEffect(()=>{loadContacts();fetch('/api/brevo/lists').then(r=>r.ok?r.json():Promise.resolve({lists:[]})).then(d=>setLists(d.lists||[])).catch(()=>{});},[loadContacts]);

  function handleListFilter(val:string){setListFilter(val);setTownFilter('');setSearch('');loadContacts(val||undefined);}
  function showToast(msg:string){setToast(msg);setTimeout(()=>setToast(null),3000);}

  async function sendEmail(c:Contact){
    if(!c.email){showToast('Contact needs an email address');return;}

    // Rate-limit guard. Without this the user can rapid-click Send and
    // bump a contact through Step 1 → 2 → 3 in minutes, blowing past the
    // intended day-spacing the cron enforces. If this contact was emailed
    // in the last 12h, ask for explicit confirmation before sending again.
    const lastContact=c.attributes?.LAST_CONTACT_DATE;
    if(lastContact){
      const hoursSince=(Date.now()-new Date(lastContact).getTime())/3_600_000;
      if(hoursSince<12){
        const businessName=c.attributes?.BUSINESS_NAME||c.attributes?.FIRSTNAME||c.email.split('@')[0]||'this contact';
        const ok=window.confirm(
          `${businessName} was already emailed within the last ${Math.max(1,Math.round(hoursSince))} hour(s). Send another email anyway?\n\nClick OK to send, or Cancel to wait for the cron to handle the day-spacing.`
        );
        if(!ok){setQueueing(null);return;}
      }
    }

    setQueueing(c.id);
    try{
      // Personalisation fallbacks for contacts that weren't imported via the
      // business-finder flow (e.g. manually-added personal contacts). Use the
      // most specific name we have: business → first name → email local-part.
      const businessName=c.attributes?.BUSINESS_NAME||c.attributes?.FIRSTNAME||c.email.split('@')[0]||'your business';
      const status=c.attributes?.OUTREACH_STATUS;
      const step:1|2|3=status==='email_sent'?2:status==='followed_up'?3:1;
      const res=await fetch('/api/brevo/send',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:c.email,businessName,town:c.attributes?.TOWN||'your area',knownFor:c.attributes?.KNOWN_FOR||'its independent spirit',step})});
      if(!res.ok)throw new Error('Send failed');
      // Status transitions match what the daily cron does. Step 3 (the final
      // nudge) goes to 'final_nudge', NOT 'cold'. The cron is the only thing
      // that should auto-cold a contact, and only after Day 14 of no response.
      const newStatus=step===1?'email_sent':step===2?'followed_up':'final_nudge';
      const todayISODate=new Date().toISOString().slice(0,10);
      const attrPatch:Record<string,string>={
        OUTREACH_STATUS:newStatus,
        // Stamp the date too so the cron's day-spacing logic counts correctly
        // from this manual send rather than the previous one.
        LAST_CONTACT_DATE:todayISODate,
      };
      if(!c.attributes?.BUSINESS_NAME)attrPatch.BUSINESS_NAME=businessName;
      await fetch('/api/brevo/contacts',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:c.email,...attrPatch})});
      showToast(`✓ Email sent to ${businessName}`);
      // Clearer attribution: "You sent" makes it explicit this was a manual
      // action, not the automated cron. Helps when scanning the notification
      // history later.
      const stepLabel=step===1?'first outreach':step===2?'follow-up':'final nudge';
      addNotification({type:'email_sent',title:'Email sent',body:`You sent the ${stepLabel} to ${businessName} (${c.email})`});
      loadContacts(listFilter||undefined);
    }catch(e){showToast('Failed to send email');console.error(e);}
    setQueueing(null);
  }

  /**
   * Reset a contact's outreach status back to 'not_contacted', so the cron
   * picks them up again from Step 1. Used to recover contacts that ended up
   * in a wrong end-state (e.g. accidentally marked cold by a manual rapid-
   * click bug, or a flaky Brevo event).
   *
   * IMPORTANT: only OUTREACH_STATUS and LAST_CONTACT_DATE are cleared.
   * Engagement attributes (LAST_OPENED_AT, OPEN_COUNT, LAST_CLICKED_AT, etc.)
   * are FACTS about what the contact did and are preserved. The reset is a
   * pipeline-state correction, not a history wipe.
   */
  async function resetStatus(c:Contact){
    if(!c.email)return;
    const businessName=c.attributes?.BUSINESS_NAME||c.attributes?.FIRSTNAME||c.email.split('@')[0]||'this contact';
    const currentStatus=c.attributes?.OUTREACH_STATUS||'not_contacted';
    const ok=window.confirm(
      `Reset ${businessName} from "${currentStatus}" back to "not_contacted"?\n\nThis lets the cron pick them up from Step 1 again. Engagement history (opens, clicks) is preserved.`
    );
    if(!ok)return;
    try{
      // Send empty string to clear LAST_CONTACT_DATE — Brevo treats empty
      // string as "unset". Without clearing it, the cron's daysSince logic
      // would still use the old date.
      await fetch('/api/brevo/contacts',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({
        email:c.email,
        OUTREACH_STATUS:'not_contacted',
        LAST_CONTACT_DATE:'',
      })});
      showToast(`✓ ${businessName} reset to Not Contacted`);
      addNotification({type:'info',title:'Status reset',body:`${businessName} reset from "${currentStatus}" \u2192 "not_contacted"`});
      loadContacts(listFilter||undefined);
    }catch(e){
      showToast('Failed to reset status');
      console.error(e);
    }
  }

  async function addToQueue(c:Contact){
    if(!c.email){showToast('Contact needs an email address');return;}
    setQueueing(c.id);
    const businessName=c.attributes?.BUSINESS_NAME||c.attributes?.FIRSTNAME||c.email.split('@')[0]||'your business';
    const attrPatch:Record<string,string>={OUTREACH_STATUS:'not_contacted'};
    if(!c.attributes?.BUSINESS_NAME)attrPatch.BUSINESS_NAME=businessName;
    await fetch('/api/brevo/contacts',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:c.email,...attrPatch})});
    setQueued(prev=>[...prev,c.id]);
    showToast(`${businessName} added to Today's Queue`);
    addNotification({type:'info',title:'Added to queue',body:`${businessName} added manually`});
    setQueueing(null);
  }

  async function createList(){
    if(!newListName.trim())return;setCreatingList(true);
    const res=await fetch('/api/brevo/lists',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:newListName.trim()})});
    const data=await res.json();
    if(data.id){setLists(prev=>[{id:data.id,name:newListName.trim(),uniqueSubscribers:0},...prev]);setNewListName('');setShowCreateList(false);}
    setCreatingList(false);
  }

  async function save(){
    if(!form.email||!form.name||!form.town)return;setSaving(true);
    const listIds=form.listId?[Number(form.listId)]:[];
    await fetch('/api/brevo/contacts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...form,listIds})});
    loadContacts(listFilter||undefined);setShowModal(false);setSaving(false);
    setForm({name:'',email:'',town:'',type:'Restaurant',website:'',phone:'',source:'manual',status:'not_contacted',notes:'',listId:''});
  }

  // Maps a stage filter (from dashboard funnel links) to a predicate.
  // Engagement stages (opened/clicked) cross-cut OUTREACH_STATUS, so they're
  // attribute-based, not status-based.
  function matchesStage(c:Contact):boolean{
    if(!stageFilter)return true;
    const a=c.attributes||{};
    const status=a.OUTREACH_STATUS||'not_contacted';
    if(stageFilter==='notContacted')return status==='not_contacted';
    if(stageFilter==='sent')return ['email_sent','followed_up','final_nudge'].includes(status);
    if(stageFilter==='opened')return !!a.LAST_OPENED_AT;
    if(stageFilter==='clicked')return !!a.LAST_CLICKED_AT;
    if(stageFilter==='listed')return status==='listed';
    if(stageFilter==='cold')return status==='cold';
    if(stageFilter==='responded')return status==='responded';
    if(stageFilter==='bounced')return !!a.BOUNCED_AT;
    return true;
  }

  const filtered=contacts.filter(c=>{
    const q=search.toLowerCase();
    const name=(c.attributes?.BUSINESS_NAME||c.attributes?.FIRSTNAME||c.email||''). toLowerCase();
    const town=(c.attributes?.TOWN||''). toLowerCase();
    const email=(c.email||''). toLowerCase();
    if(!matchesStage(c))return false;
    return(!q||name.includes(q)||town.includes(q)||email.includes(q))&&(!townFilter||c.attributes?.TOWN===townFilter);
  });

  const towns=uniqueTowns(contacts);
  const selectedList=lists.find(l=>l.id===Number(listFilter));
  const inp:React.CSSProperties={padding:'8px 12px',border:'1.5px solid var(--ink-200)',borderRadius:'var(--r-md)',fontSize:13,fontFamily:'inherit',background:'var(--white)',color:'var(--ink-900)',outline:'none',width:'100%'};
  const btnP:React.CSSProperties={display:'inline-flex',alignItems:'center',gap:6,padding:'8px 16px',borderRadius:'var(--r-md)',background:'var(--maroon-700)',color:'#fff',fontSize:12.5,fontWeight:600,border:'none',cursor:'pointer'};
  const btnG:React.CSSProperties={display:'inline-flex',alignItems:'center',gap:6,padding:'8px 14px',borderRadius:'var(--r-md)',background:'var(--white)',color:'var(--ink-700)',fontSize:12.5,fontWeight:600,border:'1.5px solid var(--ink-200)',cursor:'pointer'};

  return(
    <div className="page-wrap">
      {toast&&<div style={{position:'fixed',bottom:24,right:24,background:'var(--ink-900)',color:'white',padding:'12px 20px',borderRadius:'var(--r-md)',fontSize:13,fontWeight:500,zIndex:1000,boxShadow:'var(--shadow-lg)'}}>{toast}</div>}

      {/* Contact profile panel */}
      {selectedContact&&<ContactPanel contact={selectedContact} onClose={()=>setSelectedContact(null)} onSend={async(c)=>{setSelectedContact(null);await sendEmail(c);}} onReset={async(c)=>{setSelectedContact(null);await resetStatus(c);}}/>}

      {/* Header */}
      <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',marginBottom:20}} className="page-header">
        <div>
          <h1 style={{fontFamily:'var(--font-display)',fontSize:28,fontWeight:400,color:'var(--ink-900)',lineHeight:1}}>Contact Manager</h1>
          <p style={{fontSize:12,color:'var(--ink-400)',marginTop:5,fontWeight:500}}>{selectedList?`${selectedList.name} · ${contacts.length} contacts`:`${contacts.length} contacts · ${lists.length} lists`} · target 10–20 per location</p>
        </div>
        <div style={{display:'flex',gap:8,marginTop:2}} className="btn-row">
          <button style={btnG} onClick={()=>setShowCreateList(true)}>📋 New List</button>
          <a href="/find" style={{...btnG,textDecoration:'none'}}>⚡ Find More</a>
          <button style={btnP} onClick={()=>setShowModal(true)}>+ Add Contact</button>
        </div>
      </div>

      {/* List selector + sync */}
      <div style={{marginBottom:12}}>
        <BrevoListSelector
          value={listFilter?Number(listFilter):null}
          onChange={(id)=>handleListFilter(id===null?'':String(id))}
          onSync={()=>loadContacts(listFilter||undefined)}
        />
      </div>

      {/* Stage filter indicator */}
      {stageFilter&&(
        <div style={{marginBottom:12,padding:'8px 14px',background:'#fbeaef',border:'1px solid #f4d8df',borderRadius:'var(--r-md)',display:'flex',alignItems:'center',gap:10}}>
          <span style={{fontSize:11.5,fontWeight:600,color:'var(--ink-700)'}}>
            Filtered by stage: <strong style={{color:'var(--maroon-700)'}}>{({notContacted:'Not contacted',sent:'Email sent',opened:'Opened',clicked:'Clicked',listed:'Listed',cold:'Cold',responded:'Responded',bounced:'Bounced'} as Record<string,string>)[stageFilter]||stageFilter}</strong>
          </span>
          <button onClick={()=>{setStageFilter('');if(typeof window!=='undefined'){const url=new URL(window.location.href);url.searchParams.delete('stage');window.history.replaceState({},'',url);}}} style={{marginLeft:'auto',padding:'4px 10px',background:'transparent',border:'1px solid var(--ink-200)',borderRadius:'var(--r-sm)',fontSize:11,fontWeight:600,color:'var(--ink-500)',cursor:'pointer'}}>Clear filter</button>
        </div>
      )}

      {/* Filter bar */}
      <div style={{display:'flex',gap:8,marginBottom:16,alignItems:'center'}} className="filter-bar">
        <div style={{flex:2,position:'relative'}}>
          <Search size={13} style={{position:'absolute',left:11,top:'50%',transform:'translateY(-50%)',color:'var(--ink-400)',pointerEvents:'none'}}/>
          <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search name, email, town…" style={{...inp,paddingLeft:34}}/>
        </div>
        <select value={townFilter} onChange={e=>setTownFilter(e.target.value)} style={{...inp,width:'auto',flex:1,minWidth:120,cursor:'pointer'}}>
          <option value="">All Towns</option>
          {towns.map(t=><option key={t}>{t}</option>)}
        </select>
      </div>

      {/* Table */}
      <div style={{background:'var(--white)',borderRadius:'var(--r-lg)',boxShadow:'var(--shadow-sm)',overflow:'hidden'}}>
        <div style={{padding:'13px 18px',borderBottom:'1px solid var(--ink-100)',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
          <div style={{fontSize:13,fontWeight:700,color:'var(--ink-800)'}}>🏪 Contacts <span style={{fontSize:11.5,color:'var(--ink-400)',fontWeight:500}}>{filtered.length} shown</span></div>
          <span style={{fontSize:11,color:'var(--ink-400)',fontWeight:500}}>Click name to view profile</span>
        </div>
        {loading?<div style={{padding:48,textAlign:'center',color:'var(--ink-400)',fontSize:13}}>Loading from Brevo…</div>:filtered.length===0?<div style={{padding:48,textAlign:'center',color:'var(--ink-400)',fontSize:13}}>No contacts match your filters</div>:(
          <div className="table-wrap">
            <table style={{width:'100%',borderCollapse:'collapse',minWidth:480}}>
              <thead>
                <tr>
                  {[
                    {label:'Name / Business',cls:''},
                    {label:'Email',cls:'contacts-col-email'},
                    {label:'Town',cls:''},
                    {label:'Status',cls:''},
                    {label:'Actions',cls:''},
                  ].map(h=>(
                    <th key={h.label} className={h.cls} style={{padding:'10px 16px',textAlign:'left',fontSize:9.5,fontWeight:600,letterSpacing:'0.1em',textTransform:'uppercase',color:'var(--ink-400)',borderBottom:'1.5px solid var(--ink-100)'}}>{h.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map(c=>{
                  const nm=c.attributes?.BUSINESS_NAME||c.attributes?.FIRSTNAME||c.email||'Unknown';
                  const tp=c.attributes?.BUSINESS_TYPE||'';;
                  const tn=c.attributes?.TOWN||'—';
                  const src=(c.attributes?.SOURCE||'manual') as string;
                  const st=(c.attributes?.OUTREACH_STATUS||'not_contacted') as string;
                  const sc=srcColors[src]||srcColors.manual;
                  const isQ=queueing===c.id;const isQd=queued.includes(c.id);
                  return(
                    <tr key={c.id} style={{borderBottom:'1px solid var(--ink-100)',cursor:'default'}}>
                      <td style={{padding:'11px 16px'}}>
                        <button onClick={()=>setSelectedContact(c)} style={{background:'none',border:'none',padding:0,cursor:'pointer',textAlign:'left'}}>
                          <div style={{fontSize:13,fontWeight:600,color:'var(--maroon-700)',textDecoration:'underline',textDecorationStyle:'dotted'}}>{nm}</div>
                          {tp&&<div style={{fontSize:11,color:'var(--ink-400)',marginTop:1}}>{tp}</div>}
                        </button>
                      </td>
                      <td className="contacts-col-email" style={{padding:'11px 16px',fontSize:12,color:'var(--info)',maxWidth:200,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{c.email||'—'}</td>
                      <td style={{padding:'11px 16px',fontSize:12.5,color:'var(--ink-700)'}}>{tn}</td>
                      <td style={{padding:'11px 16px'}}>
                        <span style={{display:'inline-flex',alignItems:'center',gap:6,fontSize:12,fontWeight:500,whiteSpace:'nowrap'}}>
                          <span style={{width:7,height:7,borderRadius:'50%',background:sColors[st]||'var(--ink-300)',display:'inline-block'}}/>
                          {sLabels[st]||st}
                        </span>
                      </td>
                      <td style={{padding:'11px 16px'}}>
                        <div style={{display:'flex',gap:4}}>
                          <button onClick={()=>sendEmail(c)} disabled={isQ} title="Send email" className="icon-btn" style={{cursor:isQ?'default':'pointer',color:'var(--maroon-700)'}}><Send size={12}/></button>
                          <button onClick={()=>addToQueue(c)} disabled={isQ||isQd} title="Add to queue" className="icon-btn" style={{background:isQd?'#e8f5ee':'var(--white)',cursor:isQ||isQd?'default':'pointer',color:isQd?'var(--ok)':'var(--ink-500)'}}>{isQd?<CheckCircle size={12}/>:<Plus size={12}/>}</button>
                          <button onClick={()=>setSelectedContact(c)} title="View profile" className="icon-btn" style={{color:'var(--ink-500)'}}><Info size={12}/></button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Create List Modal */}
      {showCreateList&&<div style={{position:'fixed',inset:0,background:'rgba(26,13,18,0.5)',zIndex:500,display:'flex',alignItems:'center',justifyContent:'center'}} onClick={e=>{if(e.target===e.currentTarget)setShowCreateList(false);}}>
        <div style={{background:'var(--white)',borderRadius:'var(--r-xl)',width:460,maxWidth:'95vw',boxShadow:'var(--shadow-lg)'}}>
          <div style={{padding:'20px 24px 16px',borderBottom:'1px solid var(--ink-100)',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
            <div style={{fontFamily:'var(--font-display)',fontSize:20,color:'var(--ink-900)'}}>📋 Create New List</div>
            <button onClick={()=>setShowCreateList(false)} style={{...btnG,padding:'4px 8px'}}>✕</button>
          </div>
          <div style={{padding:'20px 24px'}}><input value={newListName} onChange={e=>setNewListName(e.target.value)} onKeyDown={e=>e.key==='Enter'&&createList()} placeholder="e.g. Whitstable — Roam Outreach" style={inp} autoFocus/></div>
          <div style={{padding:'16px 24px',borderTop:'1px solid var(--ink-100)',display:'flex',gap:8,justifyContent:'flex-end'}}>
            <button onClick={()=>setShowCreateList(false)} style={btnG}>Cancel</button>
            <button onClick={createList} disabled={creatingList||!newListName.trim()} style={{...btnP,opacity:creatingList||!newListName.trim()?0.6:1}}>{creatingList?'Creating…':'✓ Create'}</button>
          </div>
        </div>
      </div>}

      {/* Add Contact Modal */}
      {showModal&&<div style={{position:'fixed',inset:0,background:'rgba(26,13,18,0.5)',zIndex:500,display:'flex',alignItems:'center',justifyContent:'center'}} onClick={e=>{if(e.target===e.currentTarget)setShowModal(false);}}>
        <div style={{background:'var(--white)',borderRadius:'var(--r-xl)',width:540,maxWidth:'95vw',maxHeight:'90vh',overflowY:'auto',boxShadow:'var(--shadow-lg)'}}>
          <div style={{padding:'20px 24px 16px',borderBottom:'1px solid var(--ink-100)',display:'flex',justifyContent:'space-between',alignItems:'center',position:'sticky',top:0,background:'var(--white)',zIndex:1}}>
            <div style={{fontFamily:'var(--font-display)',fontSize:20,color:'var(--ink-900)'}}>Add Business Contact</div>
            <button onClick={()=>setShowModal(false)} style={{...btnG,padding:'4px 8px'}}>✕</button>
          </div>
          <div style={{padding:'20px 24px',display:'flex',flexDirection:'column',gap:14}}>
            {[{l:'Business Name *',k:'name',p:'e.g. The Harbour Arms'},{l:'Email Address *',k:'email',p:'hello@business.co.uk'},{l:'Town *',k:'town',p:'e.g. Whitstable'},{l:'Website',k:'website',p:'www.business.co.uk'},{l:'Phone',k:'phone',p:'01227 000 000'}].map(f=>(
              <div key={f.k}><label style={{display:'block',fontSize:11.5,fontWeight:600,color:'var(--ink-600)',marginBottom:5}}>{f.l}</label><input value={form[f.k as keyof typeof form]} onChange={e=>setForm({...form,[f.k]:e.target.value})} placeholder={f.p} style={inp}/></div>
            ))}
            <div className="form-grid">
              <div><label style={{display:'block',fontSize:11.5,fontWeight:600,color:'var(--ink-600)',marginBottom:5}}>Business Type</label>
              <select value={form.type} onChange={e=>setForm({...form,type:e.target.value})} style={{...inp,cursor:'pointer'}}><option>Restaurant</option><option>Café / Coffee Shop</option><option>Pub / Bar</option><option>Retail / Shop</option><option>Accommodation</option><option>Activity / Experience</option><option>Other</option></select></div>
              <div><label style={{display:'block',fontSize:11.5,fontWeight:600,color:'var(--ink-600)',marginBottom:5}}>Add to List</label>
              <select value={form.listId} onChange={e=>setForm({...form,listId:e.target.value})} style={{...inp,cursor:'pointer'}}><option value="">No list</option>{lists.map(l=><option key={l.id} value={l.id}>{l.name}</option>)}</select></div>
            </div>
          </div>
          <div style={{padding:'16px 24px',borderTop:'1px solid var(--ink-100)',display:'flex',gap:8,justifyContent:'flex-end',position:'sticky',bottom:0,background:'var(--white)'}}>
            <button onClick={()=>setShowModal(false)} style={btnG}>Cancel</button>
            <button onClick={save} disabled={saving} style={{...btnP,opacity:saving?0.6:1}}>{saving?'Saving…':'✓ Save to Brevo'}</button>
          </div>
        </div>
      </div>}
    </div>
  );
}
