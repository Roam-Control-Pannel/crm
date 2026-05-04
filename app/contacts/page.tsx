'use client';
import {useState,useEffect,useCallback} from 'react';

interface Contact {id:number;email:string;attributes:Record<string,string>;listIds?:number[];}
interface BrevoList {id:number;name:string;uniqueSubscribers:number;}

const sColors:Record<string,string>={not_contacted:'var(--ink-300)',email_sent:'var(--warn)',followed_up:'var(--warn)',responded:'var(--info)',listed:'var(--ok)',cold:'var(--alert)'};
const sLabels:Record<string,string>={not_contacted:'Not contacted',email_sent:'Email sent',followed_up:'Followed up',responded:'Responded',listed:'Listed ✓',cold:'Cold'};
const srcColors:Record<string,{bg:string;color:string}>={
  google:{bg:'#e4f0fb',color:'var(--info)'},
  yell:{bg:'#fdf0e4',color:'var(--warn)'},
  manual:{bg:'var(--ink-100)',color:'var(--ink-500)'},
};

function uniqueTowns(contacts:Contact[]):string[]{
  const seen:Record<string,boolean>={};
  const out:string[]=[];
  contacts.forEach(c=>{const t=c.attributes?.TOWN;if(t&&!seen[t]){seen[t]=true;out.push(t);}});
  return out.sort();
}

export default function ContactsPage(){
  const [contacts,setContacts]=useState<Contact[]>([]);
  const [lists,setLists]=useState<BrevoList[]>([]);
  const [loading,setLoading]=useState(true);
  const [search,setSearch]=useState('');
  const [townFilter,setTownFilter]=useState('');
  const [listFilter,setListFilter]=useState('');
  const [showModal,setShowModal]=useState(false);
  const [showCreateList,setShowCreateList]=useState(false);
  const [newListName,setNewListName]=useState('');
  const [creatingList,setCreatingList]=useState(false);
  const [saving,setSaving]=useState(false);
  const [queueing,setQueueing]=useState<number|null>(null);
  const [queued,setQueued]=useState<number[]>([]);
  const [toast,setToast]=useState<string|null>(null);
  const [form,setForm]=useState({name:'',email:'',town:'',type:'Restaurant',website:'',phone:'',source:'manual',status:'not_contacted',notes:'',listId:''});

  const loadContacts=useCallback((listId?:string)=>{
    setLoading(true);
    const url=listId?`/api/brevo/contacts?limit=500&listId=${listId}`:`/api/brevo/contacts?limit=500`;
    fetch(url).then(r=>r.json()).then(d=>{setContacts(d.contacts||[]);setLoading(false);}).catch(()=>setLoading(false));
  },[]);

  useEffect(()=>{
    loadContacts();
    fetch('/api/brevo/lists').then(r=>r.ok?r.json():Promise.resolve({lists:[]})).then(d=>setLists(d.lists||[])).catch(()=>{});
  },[loadContacts]);

  function handleListFilter(val:string){setListFilter(val);setTownFilter('');setSearch('');loadContacts(val||undefined);}

  function showToast(msg:string){
    setToast(msg);
    setTimeout(()=>setToast(null),3000);
  }

  async function addToQueue(c:Contact){
    if(!c.email||!c.attributes?.BUSINESS_NAME){
      showToast('Contact needs a business name and email to be queued');
      return;
    }
    setQueueing(c.id);
    try{
      // Update contact status to trigger queue inclusion
      await fetch('/api/brevo/contacts',{
        method:'PUT',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({email:c.email,OUTREACH_STATUS:'not_contacted'}),
      });
      setQueued(prev=>[...prev,c.id]);
      showToast(`${c.attributes.BUSINESS_NAME} added to Today's Queue`);
    }catch(e){
      showToast('Failed to add to queue');
      console.error(e);
    }
    setQueueing(null);
  }

  async function sendEmail(c:Contact){
    if(!c.email||!c.attributes?.BUSINESS_NAME){
      showToast('Contact needs a business name and email');
      return;
    }
    setQueueing(c.id);
    try{
      const step=c.attributes?.OUTREACH_STATUS==='email_sent'?2:c.attributes?.OUTREACH_STATUS==='followed_up'?3:1;
      const res=await fetch('/api/brevo/send',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({
          email:c.email,
          businessName:c.attributes.BUSINESS_NAME,
          town:c.attributes?.TOWN||'your area',
          knownFor:c.attributes?.KNOWN_FOR||'its independent spirit',
          step,
        }),
      });
      if(!res.ok)throw new Error('Send failed');
      // Update status
      const newStatus=step===1?'email_sent':step===2?'followed_up':'cold';
      await fetch('/api/brevo/contacts',{
        method:'PUT',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({email:c.email,OUTREACH_STATUS:newStatus}),
      });
      showToast(`✓ Email sent to ${c.attributes.BUSINESS_NAME}`);
      loadContacts(listFilter||undefined);
    }catch(e){
      showToast('Failed to send email');
      console.error(e);
    }
    setQueueing(null);
  }

  async function createList(){
    if(!newListName.trim())return;
    setCreatingList(true);
    try{
      const res=await fetch('/api/brevo/lists',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:newListName.trim()})});
      const data=await res.json();
      if(data.id){setLists(prev=>[{id:data.id,name:newListName.trim(),uniqueSubscribers:0},...prev]);setForm(f=>({...f,listId:String(data.id)}));setNewListName('');setShowCreateList(false);}
    }catch(e){console.error(e);}
    setCreatingList(false);
  }

  const filtered=contacts.filter(c=>{
    const q=search.toLowerCase();
    const name=(c.attributes?.BUSINESS_NAME||c.attributes?.FIRSTNAME||c.email||'').toLowerCase();
    const town=(c.attributes?.TOWN||'').toLowerCase();
    const email=(c.email||'').toLowerCase();
    return(!q||name.includes(q)||town.includes(q)||email.includes(q))&&(!townFilter||c.attributes?.TOWN===townFilter);
  });

  const towns=uniqueTowns(contacts);
  const selectedList=lists.find(l=>l.id===Number(listFilter));

  async function save(){
    if(!form.email||!form.name||!form.town)return;
    setSaving(true);
    const listIds=form.listId?[Number(form.listId)]:[];
    await fetch('/api/brevo/contacts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...form,listIds})});
    loadContacts(listFilter||undefined);setShowModal(false);setSaving(false);
    setForm({name:'',email:'',town:'',type:'Restaurant',website:'',phone:'',source:'manual',status:'not_contacted',notes:'',listId:''});
  }

  const inp:React.CSSProperties={padding:'8px 12px',border:'1.5px solid var(--ink-200)',borderRadius:'var(--r-md)',fontSize:13,fontFamily:'inherit',background:'var(--white)',color:'var(--ink-900)',outline:'none',width:'100%'};
  const btnP:React.CSSProperties={display:'inline-flex',alignItems:'center',gap:6,padding:'8px 16px',borderRadius:'var(--r-md)',fontSize:12.5,fontWeight:600,cursor:'pointer',border:'none',fontFamily:'inherit',background:'var(--maroon-700)',color:'#fff'};
  const btnG:React.CSSProperties={display:'inline-flex',alignItems:'center',gap:6,padding:'8px 14px',borderRadius:'var(--r-md)',fontSize:12.5,fontWeight:600,cursor:'pointer',fontFamily:'inherit',background:'var(--white)',color:'var(--ink-700)',border:'1.5px solid var(--ink-200)'};

  return (
    <div style={{padding:'24px 28px'}}>
      {/* Toast */}
      {toast&&(
        <div style={{position:'fixed',bottom:24,right:24,background:'var(--ink-900)',color:'white',padding:'12px 20px',borderRadius:'var(--r-md)',fontSize:13,fontWeight:500,zIndex:1000,boxShadow:'var(--shadow-lg)',transition:'all 0.3s'}}>
          {toast}
        </div>
      )}

      {/* Header */}
      <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',marginBottom:20}}>
        <div>
          <h1 style={{fontFamily:'var(--font-display)',fontSize:28,fontWeight:400,color:'var(--ink-900)',lineHeight:1}}>Contact Manager</h1>
          <p style={{fontSize:12,color:'var(--ink-400)',marginTop:5,fontWeight:500}}>
            {selectedList?`${selectedList.name} · ${contacts.length} contacts`:`${contacts.length} contacts · ${lists.length} lists`} · target 10–20 per location
          </p>
        </div>
        <div style={{display:'flex',gap:8,marginTop:2}}>
          <button style={btnG} onClick={()=>setShowCreateList(true)}>📋 New List</button>
          <a href="/find" style={{...btnG,textDecoration:'none'}}>⚡ Find More</a>
          <button style={btnP} onClick={()=>setShowModal(true)}>➕ Add Contact</button>
        </div>
      </div>

      {/* Filter bar */}
      <div style={{display:'flex',gap:8,marginBottom:16,alignItems:'center'}}>
        <div style={{flex:2,position:'relative'}}>
          <span style={{position:'absolute',left:11,top:'50%',transform:'translateY(-50%)',fontSize:13,color:'var(--ink-400)',pointerEvents:'none'}}>🔍</span>
          <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search name, email, town…" style={{...inp,paddingLeft:34}}/>
        </div>
        {lists.length>0&&(
          <select value={listFilter} onChange={e=>handleListFilter(e.target.value)} style={{...inp,width:'auto',flex:1.5,minWidth:180,cursor:'pointer'}}>
            <option value="">📋 All Contacts</option>
            {lists.map(l=><option key={l.id} value={l.id}>{l.name} ({l.uniqueSubscribers})</option>)}
          </select>
        )}
        <select value={townFilter} onChange={e=>setTownFilter(e.target.value)} style={{...inp,width:'auto',flex:1,minWidth:120,cursor:'pointer'}}>
          <option value="">All Towns</option>
          {towns.map(t=><option key={t}>{t}</option>)}
        </select>
      </div>

      {/* Table */}
      <div style={{background:'var(--white)',borderRadius:'var(--r-lg)',boxShadow:'var(--shadow-sm)',overflow:'hidden'}}>
        <div style={{padding:'13px 18px',borderBottom:'1px solid var(--ink-100)',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
          <div style={{fontSize:13,fontWeight:700,color:'var(--ink-800)'}}>
            🏪 Contacts <span style={{fontSize:11.5,color:'var(--ink-400)',fontWeight:500}}>{filtered.length} shown{listFilter?` in list`:` of ${contacts.length}`}</span>
          </div>
          <span style={{fontSize:11,color:'var(--ink-400)',fontWeight:500}}>Target: 10–20 per town</span>
        </div>
        {loading?(
          <div style={{padding:48,textAlign:'center',color:'var(--ink-400)',fontSize:13}}>Loading from Brevo…</div>
        ):contacts.length===0?(
          <div style={{padding:48,textAlign:'center',color:'var(--ink-400)',fontSize:13}}>No contacts in this list yet</div>
        ):filtered.length===0?(
          <div style={{padding:48,textAlign:'center',color:'var(--ink-400)',fontSize:13}}>No contacts match your filters</div>
        ):(
          <div style={{overflowX:'auto'}}>
            <table style={{width:'100%',borderCollapse:'collapse'}}>
              <thead>
                <tr>{['Name / Business','Email','Town','Source','Status','Actions'].map(h=>(
                  <th key={h} style={{padding:'10px 16px',textAlign:'left',fontSize:9.5,fontWeight:600,letterSpacing:'0.1em',textTransform:'uppercase',color:'var(--ink-400)',borderBottom:'1.5px solid var(--ink-100)',whiteSpace:'nowrap'}}>{h}</th>
                ))}</tr>
              </thead>
              <tbody>
                {filtered.map(c=>{
                  const nm=c.attributes?.BUSINESS_NAME||c.attributes?.FIRSTNAME||c.email||'Unknown';
                  const tp=c.attributes?.BUSINESS_TYPE||'';
                  const tn=c.attributes?.TOWN||'—';
                  const src=(c.attributes?.SOURCE||'manual') as string;
                  const st=(c.attributes?.OUTREACH_STATUS||'not_contacted') as string;
                  const sc=srcColors[src]||srcColors.manual;
                  const isQueueing=queueing===c.id;
                  const isQueued=queued.includes(c.id);
                  return (
                    <tr key={c.id} style={{borderBottom:'1px solid var(--ink-100)'}}>
                      <td style={{padding:'11px 16px'}}>
                        <div style={{fontSize:13,fontWeight:600,color:'var(--ink-900)'}}>{nm}</div>
                        {tp&&<div style={{fontSize:11,color:'var(--ink-400)',marginTop:1}}>{tp}</div>}
                      </td>
                      <td style={{padding:'11px 16px',fontSize:12,color:'var(--info)',fontWeight:500,maxWidth:200,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{c.email||'—'}</td>
                      <td style={{padding:'11px 16px',fontSize:12.5,color:'var(--ink-700)'}}>{tn}</td>
                      <td style={{padding:'11px 16px'}}>
                        <span style={{display:'inline-flex',alignItems:'center',padding:'3px 9px',borderRadius:'var(--r-pill)',fontSize:10.5,fontWeight:500,background:sc.bg,color:sc.color,textTransform:'capitalize'}}>{src}</span>
                      </td>
                      <td style={{padding:'11px 16px'}}>
                        <span style={{display:'inline-flex',alignItems:'center',gap:6,fontSize:12,fontWeight:500,whiteSpace:'nowrap'}}>
                          <span style={{width:7,height:7,borderRadius:'50%',background:sColors[st]||'var(--ink-300)',display:'inline-block',flexShrink:0}}/>
                          {sLabels[st]||st}
                        </span>
                      </td>
                      <td style={{padding:'11px 16px'}}>
                        <div style={{display:'flex',gap:4}}>
                          {/* Send email now */}
                          <button
                            onClick={()=>sendEmail(c)}
                            disabled={isQueueing}
                            title="Send outreach email now"
                            style={{
                              width:30,height:30,borderRadius:'var(--r-xs)',
                              border:'1.5px solid var(--ink-200)',
                              background:isQueueing?'var(--ink-100)':'var(--white)',
                              display:'flex',alignItems:'center',justifyContent:'center',
                              fontSize:13,cursor:isQueueing?'default':'pointer',
                              color:'var(--maroon-700)',
                              title:'Send email now',
                            }}
                          >✉</button>
                          {/* Add to queue manually */}
                          <button
                            onClick={()=>addToQueue(c)}
                            disabled={isQueueing||isQueued}
                            title="Add to Today's Queue"
                            style={{
                              width:30,height:30,borderRadius:'var(--r-xs)',
                              border:'1.5px solid var(--ink-200)',
                              background:isQueued?'#e8f5ee':isQueueing?'var(--ink-100)':'var(--white)',
                              display:'flex',alignItems:'center',justifyContent:'center',
                              fontSize:13,cursor:isQueueing||isQueued?'default':'pointer',
                              color:isQueued?'var(--ok)':'var(--ink-500)',
                            }}
                          >{isQueued?'✓':'+'}</button>
                          {/* Edit */}
                          <button
                            title="Edit contact"
                            style={{
                              width:30,height:30,borderRadius:'var(--r-xs)',
                              border:'1.5px solid var(--ink-200)',background:'var(--white)',
                              display:'flex',alignItems:'center',justifyContent:'center',
                              fontSize:13,cursor:'pointer',color:'var(--ink-500)',
                            }}
                          >✎</button>
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
      {showCreateList&&(
        <div style={{position:'fixed',inset:0,background:'rgba(26,13,18,0.5)',zIndex:500,display:'flex',alignItems:'center',justifyContent:'center',backdropFilter:'blur(4px)'}} onClick={e=>{if(e.target===e.currentTarget)setShowCreateList(false);}}>
          <div style={{background:'var(--white)',borderRadius:'var(--r-xl)',width:460,maxWidth:'95vw',boxShadow:'var(--shadow-lg)'}}>
            <div style={{padding:'20px 24px 16px',borderBottom:'1px solid var(--ink-100)',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
              <div style={{fontFamily:'var(--font-display)',fontSize:20,color:'var(--ink-900)'}}>📋 Create New List</div>
              <button onClick={()=>setShowCreateList(false)} style={{width:28,height:28,borderRadius:'var(--r-xs)',border:'1.5px solid var(--ink-200)',background:'var(--white)',fontSize:16,cursor:'pointer',color:'var(--ink-500)'}}>✕</button>
            </div>
            <div style={{padding:'20px 24px'}}>
              <div style={{fontSize:12,color:'var(--ink-400)',marginBottom:14,lineHeight:1.6}}>Creates a new list in Brevo. Use names like <strong style={{color:'var(--ink-800)'}}>Whitstable — Roam Outreach</strong></div>
              <label style={{display:'block',fontSize:11.5,fontWeight:600,color:'var(--ink-600)',marginBottom:6}}>List Name *</label>
              <input value={newListName} onChange={e=>setNewListName(e.target.value)} onKeyDown={e=>e.key==='Enter'&&createList()} placeholder="e.g. Whitstable — Roam Outreach" style={inp} autoFocus/>
            </div>
            <div style={{padding:'16px 24px',borderTop:'1px solid var(--ink-100)',display:'flex',gap:8,justifyContent:'flex-end'}}>
              <button onClick={()=>setShowCreateList(false)} style={btnG}>Cancel</button>
              <button onClick={createList} disabled={creatingList||!newListName.trim()} style={{...btnP,opacity:creatingList||!newListName.trim()?0.6:1}}>{creatingList?'Creating…':'✓ Create in Brevo'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Add Contact Modal */}
      {showModal&&(
        <div style={{position:'fixed',inset:0,background:'rgba(26,13,18,0.5)',zIndex:500,display:'flex',alignItems:'center',justifyContent:'center',backdropFilter:'blur(4px)'}} onClick={e=>{if(e.target===e.currentTarget)setShowModal(false);}}>
          <div style={{background:'var(--white)',borderRadius:'var(--r-xl)',width:540,maxWidth:'95vw',maxHeight:'90vh',overflowY:'auto',boxShadow:'var(--shadow-lg)'}}>
            <div style={{padding:'20px 24px 16px',borderBottom:'1px solid var(--ink-100)',display:'flex',justifyContent:'space-between',alignItems:'center',position:'sticky',top:0,background:'var(--white)',zIndex:1}}>
              <div style={{fontFamily:'var(--font-display)',fontSize:20,color:'var(--ink-900)'}}>➕ Add Business Contact</div>
              <button onClick={()=>setShowModal(false)} style={{width:28,height:28,borderRadius:'var(--r-xs)',border:'1.5px solid var(--ink-200)',background:'var(--white)',fontSize:16,cursor:'pointer',color:'var(--ink-500)'}}>✕</button>
            </div>
            <div style={{padding:'20px 24px',display:'flex',flexDirection:'column',gap:14}}>
              {[{l:'Business Name *',k:'name',p:'e.g. The Harbour Arms'},{l:'Email Address *',k:'email',p:'hello@business.co.uk'},{l:'Town *',k:'town',p:'e.g. Whitstable'},{l:'Website',k:'website',p:'www.business.co.uk'},{l:'Phone',k:'phone',p:'01227 000 000'}].map(f=>(
                <div key={f.k}>
                  <label style={{display:'block',fontSize:11.5,fontWeight:600,color:'var(--ink-600)',marginBottom:5}}>{f.l}</label>
                  <input value={form[f.k as keyof typeof form]} onChange={e=>setForm({...form,[f.k]:e.target.value})} placeholder={f.p} style={inp}/>
                </div>
              ))}
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:14}}>
                <div>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:5}}>
                    <label style={{fontSize:11.5,fontWeight:600,color:'var(--ink-600)'}}>Add to List</label>
                    <button onClick={()=>{setShowModal(false);setShowCreateList(true);}} style={{fontSize:10.5,fontWeight:600,color:'var(--maroon-600)',background:'none',border:'none',cursor:'pointer'}}>+ New list</button>
                  </div>
                  <select value={form.listId} onChange={e=>setForm({...form,listId:e.target.value})} style={{...inp,cursor:'pointer'}}>
                    <option value="">No list</option>
                    {lists.map(l=><option key={l.id} value={l.id}>{l.name}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{display:'block',fontSize:11.5,fontWeight:600,color:'var(--ink-600)',marginBottom:5}}>Business Type</label>
                  <select value={form.type} onChange={e=>setForm({...form,type:e.target.value})} style={{...inp,cursor:'pointer'}}>
                    <option>Restaurant</option><option>Café / Coffee Shop</option><option>Pub / Bar</option><option>Retail / Shop</option><option>Accommodation</option><option>Activity / Experience</option><option>Other</option>
                  </select>
                </div>
              </div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:14}}>
                <div>
                  <label style={{display:'block',fontSize:11.5,fontWeight:600,color:'var(--ink-600)',marginBottom:5}}>Source</label>
                  <select value={form.source} onChange={e=>setForm({...form,source:e.target.value})} style={{...inp,cursor:'pointer'}}>
                    <option value="manual">Manual entry</option><option value="google">Google Places</option>
                  </select>
                </div>
                <div>
                  <label style={{display:'block',fontSize:11.5,fontWeight:600,color:'var(--ink-600)',marginBottom:5}}>Status</label>
                  <select value={form.status} onChange={e=>setForm({...form,status:e.target.value})} style={{...inp,cursor:'pointer'}}>
                    <option value="not_contacted">Not contacted</option><option value="email_sent">Email sent</option><option value="responded">Responded</option><option value="listed">Listed ✓</option>
                  </select>
                </div>
              </div>
              <div>
                <label style={{display:'block',fontSize:11.5,fontWeight:600,color:'var(--ink-600)',marginBottom:5}}>Notes</label>
                <textarea value={form.notes} onChange={e=>setForm({...form,notes:e.target.value})} placeholder="e.g. Spoke to owner Sarah, very interested…" rows={2} style={{...inp,resize:'vertical'}}/>
              </div>
            </div>
            <div style={{padding:'16px 24px',borderTop:'1px solid var(--ink-100)',display:'flex',gap:8,justifyContent:'flex-end',position:'sticky',bottom:0,background:'var(--white)'}}>
              <button onClick={()=>setShowModal(false)} style={btnG}>Cancel</button>
              <button onClick={save} disabled={saving} style={{...btnP,opacity:saving?0.6:1}}>{saving?'Saving…':'✓ Save to Brevo'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
