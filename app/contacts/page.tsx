'use client';
import {useState,useEffect,useCallback} from 'react';

interface Contact {id:number;email:string;attributes:Record<string,string>;listIds?:number[];}
interface BrevoList {id:number;name:string;uniqueSubscribers:number;}

const sColors:Record<string,string>={not_contacted:'#aaa',email_sent:'#b06820',followed_up:'#b06820',responded:'#1a6b9a',listed:'#2d7a4f',cold:'#8B1A3A'};
const sLabels:Record<string,string>={not_contacted:'Not contacted',email_sent:'Email sent',followed_up:'Followed up',responded:'Responded',listed:'Listed ✓',cold:'Cold'};
const srcS:Record<string,{bg:string;color:string}>={google:{bg:'#e4f2fb',color:'#1a6b9a'},yell:{bg:'#fdf0e4',color:'#b06820'},manual:{bg:'#e8f5ee',color:'#2d7a4f'}};
const inp:React.CSSProperties={padding:'9px 12px',border:'1.5px solid #e4d8dc',borderRadius:8,fontSize:13,fontFamily:'Nunito Sans,sans-serif',background:'#fff',color:'#1a0d12',outline:'none',width:'100%'};
const btnP:React.CSSProperties={display:'inline-flex',alignItems:'center',gap:6,padding:'8px 16px',borderRadius:8,fontSize:12.5,fontWeight:700,cursor:'pointer',border:'none',fontFamily:'Nunito Sans,sans-serif',background:'linear-gradient(135deg,#6B1230,#8B1A3A)',color:'#fff',boxShadow:'0 2px 8px rgba(139,26,58,0.28)'};
const btnG:React.CSSProperties={display:'inline-flex',alignItems:'center',gap:6,padding:'8px 16px',borderRadius:8,fontSize:12.5,fontWeight:700,cursor:'pointer',fontFamily:'Nunito Sans,sans-serif',background:'transparent',color:'#6b4a55',border:'1.5px solid #e4d8dc'};

function uniqueTowns(contacts:Contact[]):string[]{
  const seen:Record<string,boolean>={};
  const result:string[]=[];
  contacts.forEach(c=>{const t=c.attributes?.TOWN;if(t&&!seen[t]){seen[t]=true;result.push(t);}});
  return result.sort();
}

export default function ContactsPage() {
  const [contacts,setContacts]=useState<Contact[]>([]);
  const [lists,setLists]=useState<BrevoList[]>([]);
  const [loading,setLoading]=useState(true);
  const [search,setSearch]=useState('');
  const [townFilter,setTownFilter]=useState('');
  const [listFilter,setListFilter]=useState('');
  const [showModal,setShowModal]=useState(false);
  const [saving,setSaving]=useState(false);
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

  function handleListFilter(val:string){
    setListFilter(val);
    setTownFilter('');
    setSearch('');
    loadContacts(val||undefined);
  }

  const filtered=contacts.filter(c=>{
    const q=search.toLowerCase();
    const name=(c.attributes?.BUSINESS_NAME||c.attributes?.FIRSTNAME||c.email||'').toLowerCase();
    const town=(c.attributes?.TOWN||'').toLowerCase();
    const email=(c.email||'').toLowerCase();
    const matchQ=!q||name.includes(q)||town.includes(q)||email.includes(q);
    const matchTown=!townFilter||c.attributes?.TOWN===townFilter;
    return matchQ&&matchTown;
  });

  const towns=uniqueTowns(contacts);
  const selectedList=lists.find(l=>l.id===Number(listFilter));

  async function save(){
    if(!form.email||!form.name||!form.town)return;
    setSaving(true);
    const listIds=form.listId?[Number(form.listId)]:[];
    await fetch('/api/brevo/contacts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...form,listIds})});
    loadContacts(listFilter||undefined);
    setShowModal(false);setSaving(false);
    setForm({name:'',email:'',town:'',type:'Restaurant',website:'',phone:'',source:'manual',status:'not_contacted',notes:'',listId:''});
  }

  return (
    <div style={{padding:'22px 24px'}}>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:20}}>
        <div>
          <h1 style={{fontFamily:'Nunito,sans-serif',fontSize:22,fontWeight:900,color:'#1a0d12',margin:0}}>Contact Manager</h1>
          <p style={{fontSize:12,color:'#9e7e88',margin:'3px 0 0',fontWeight:500}}>
            {selectedList?`${selectedList.name} · ${contacts.length} contacts`:`${contacts.length} contacts · ${lists.length} lists`} · target 10–20 per location
          </p>
        </div>
        <div style={{display:'flex',gap:8}}>
          <a href="/find" style={{...btnG,textDecoration:'none'}}>⚡ Find More</a>
          <button style={btnP} onClick={()=>setShowModal(true)}>➕ Add Contact</button>
        </div>
      </div>

      <div style={{display:'flex',gap:10,marginBottom:16,flexWrap:'wrap'}}>
        <div style={{flex:2,minWidth:200,position:'relative'}}>
          <span style={{position:'absolute',left:10,top:'50%',transform:'translateY(-50%)',fontSize:13}}>🔍</span>
          <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search name, email, town…" style={{...inp,paddingLeft:34}}/>
        </div>
        {lists.length>0&&(
          <select value={listFilter} onChange={e=>handleListFilter(e.target.value)} style={{...inp,width:'auto',cursor:'pointer',flex:1,minWidth:220}}>
            <option value="">📋 All Contacts</option>
            {lists.map(l=><option key={l.id} value={l.id}>{l.name} ({l.uniqueSubscribers})</option>)}
          </select>
        )}
        <select value={townFilter} onChange={e=>setTownFilter(e.target.value)} style={{...inp,width:'auto',cursor:'pointer',flex:1,minWidth:140}}>
          <option value="">All Towns</option>
          {towns.map(t=><option key={t}>{t}</option>)}
        </select>
      </div>

      <div style={{background:'#fff',border:'1px solid #e4d8dc',borderRadius:12,overflow:'hidden'}}>
        <div style={{padding:'15px 20px',borderBottom:'1px solid #e4d8dc',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
          <div style={{fontFamily:'Nunito,sans-serif',fontSize:14,fontWeight:800}}>
            🏪 Contacts <span style={{fontSize:12,color:'#9e7e88',fontWeight:600}}>{filtered.length} shown{listFilter?` in list`:` of ${contacts.length}`}</span>
          </div>
          <span style={{fontSize:11,color:'#9e7e88',fontWeight:600}}>Target: 10–20 per town</span>
        </div>
        {loading
          ?<div style={{padding:40,textAlign:'center',color:'#9e7e88',fontSize:13}}>Loading from Brevo…</div>
          :contacts.length===0
          ?<div style={{padding:40,textAlign:'center',color:'#9e7e88',fontSize:13}}>No contacts in this list yet</div>
          :filtered.length===0
          ?<div style={{padding:40,textAlign:'center',color:'#9e7e88',fontSize:13}}>No contacts match your filters</div>
          :<div style={{overflowX:'auto'}}>
            <table style={{width:'100%',borderCollapse:'collapse'}}>
              <thead>
                <tr>{['Name / Business','Email','Town','Source','Status','Actions'].map(h=>(
                  <th key={h} style={{padding:'10px 14px',textAlign:'left',fontSize:10,fontWeight:800,letterSpacing:1,textTransform:'uppercase',color:'#9e7e88',borderBottom:'2px solid #e4d8dc',whiteSpace:'nowrap'}}>{h}</th>
                ))}</tr>
              </thead>
              <tbody>
                {filtered.map(c=>{
                  const nm=c.attributes?.BUSINESS_NAME||c.attributes?.FIRSTNAME||c.email||'Unknown';
                  const tp=c.attributes?.BUSINESS_TYPE||'';
                  const tn=c.attributes?.TOWN||'—';
                  const src=(c.attributes?.SOURCE||'manual') as string;
                  const st=(c.attributes?.OUTREACH_STATUS||'not_contacted') as string;
                  const sc=srcS[src]||srcS.manual;
                  return (
                    <tr key={c.id} style={{borderBottom:'1px solid #e4d8dc'}}>
                      <td style={{padding:'12px 14px'}}><div style={{fontSize:13,fontWeight:700}}>{nm}</div><div style={{fontSize:11,color:'#9e7e88'}}>{tp}</div></td>
                      <td style={{padding:'12px 14px',fontSize:11.5,color:'#1a6b9a',fontWeight:600}}>{c.email||'—'}</td>
                      <td style={{padding:'12px 14px',fontSize:12.5}}>{tn}</td>
                      <td style={{padding:'12px 14px'}}><span style={{fontSize:9,fontWeight:700,padding:'2px 8px',borderRadius:20,background:sc.bg,color:sc.color,textTransform:'capitalize'}}>{src}</span></td>
                      <td style={{padding:'12px 14px'}}><span style={{display:'inline-flex',alignItems:'center',gap:5,fontSize:11,fontWeight:700}}><span style={{width:7,height:7,borderRadius:'50%',background:sColors[st]||'#aaa',display:'inline-block'}}/>{sLabels[st]||st}</span></td>
                      <td style={{padding:'12px 14px'}}><div style={{display:'flex',gap:5}}>{['✉','✎'].map(ic=><div key={ic} style={{width:28,height:28,borderRadius:6,border:'1.5px solid #e4d8dc',background:'#fff',display:'flex',alignItems:'center',justifyContent:'center',fontSize:13,cursor:'pointer'}}>{ic}</div>)}</div></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        }
      </div>

      {showModal&&(
        <div style={{position:'fixed',inset:0,background:'rgba(26,13,18,0.5)',zIndex:500,display:'flex',alignItems:'center',justifyContent:'center',backdropFilter:'blur(3px)'}} onClick={e=>{if(e.target===e.currentTarget)setShowModal(false);}}>
          <div style={{background:'#fff',borderRadius:16,width:540,maxWidth:'95vw',maxHeight:'90vh',overflowY:'auto',boxShadow:'0 8px 32px rgba(26,13,18,0.14)'}}>
            <div style={{padding:'20px 24px 16px',borderBottom:'1px solid #e4d8dc',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
              <div style={{fontFamily:'Nunito,sans-serif',fontSize:16,fontWeight:800}}>➕ Add Business Contact</div>
              <button onClick={()=>setShowModal(false)} style={{width:30,height:30,borderRadius:6,border:'1.5px solid #e4d8dc',background:'#fff',fontSize:16,cursor:'pointer'}}>✕</button>
            </div>
            <div style={{padding:'20px 24px',display:'flex',flexDirection:'column',gap:14}}>
              {[{l:'Business Name *',k:'name',p:'e.g. The Harbour Arms'},{l:'Email Address *',k:'email',p:'hello@business.co.uk'},{l:'Town *',k:'town',p:'e.g. Whitstable'},{l:'Website',k:'website',p:'www.business.co.uk'},{l:'Phone',k:'phone',p:'01227 000 000'}].map(f=>(
                <div key={f.k}>
                  <label style={{display:'block',fontSize:11.5,fontWeight:700,color:'#6b4a55',marginBottom:5}}>{f.l}</label>
                  <input value={form[f.k as keyof typeof form]} onChange={e=>setForm({...form,[f.k]:e.target.value})} placeholder={f.p} style={inp}/>
                </div>
              ))}
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:14}}>
                <div>
                  <label style={{display:'block',fontSize:11.5,fontWeight:700,color:'#6b4a55',marginBottom:5}}>Add to List</label>
                  <select value={form.listId} onChange={e=>setForm({...form,listId:e.target.value})} style={{...inp,cursor:'pointer'}}>
                    <option value="">No list</option>
                    {lists.map(l=><option key={l.id} value={l.id}>{l.name}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{display:'block',fontSize:11.5,fontWeight:700,color:'#6b4a55',marginBottom:5}}>Business Type</label>
                  <select value={form.type} onChange={e=>setForm({...form,type:e.target.value})} style={{...inp,cursor:'pointer'}}>
                    <option>Restaurant</option><option>Café / Coffee Shop</option>
                    <option>Pub / Bar</option><option>Retail / Shop</option>
                    <option>Accommodation</option><option>Activity / Experience</option><option>Other</option>
                  </select>
                </div>
              </div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:14}}>
                <div>
                  <label style={{display:'block',fontSize:11.5,fontWeight:700,color:'#6b4a55',marginBottom:5}}>Source</label>
                  <select value={form.source} onChange={e=>setForm({...form,source:e.target.value})} style={{...inp,cursor:'pointer'}}>
                    <option value="manual">Manual entry</option>
                    <option value="google">Google Places</option>
                    <option value="yell">Yell.com</option>
                  </select>
                </div>
                <div>
                  <label style={{display:'block',fontSize:11.5,fontWeight:700,color:'#6b4a55',marginBottom:5}}>Status</label>
                  <select value={form.status} onChange={e=>setForm({...form,status:e.target.value})} style={{...inp,cursor:'pointer'}}>
                    <option value="not_contacted">Not contacted</option>
                    <option value="email_sent">Email sent</option>
                    <option value="responded">Responded</option>
                    <option value="listed">Listed ✓</option>
                  </select>
                </div>
              </div>
              <div>
                <label style={{display:'block',fontSize:11.5,fontWeight:700,color:'#6b4a55',marginBottom:5}}>Notes</label>
                <textarea value={form.notes} onChange={e=>setForm({...form,notes:e.target.value})} placeholder="e.g. Spoke to owner Sarah…" rows={2} style={{...inp,resize:'vertical'}}/>
              </div>
            </div>
            <div style={{padding:'16px 24px',borderTop:'1px solid #e4d8dc',display:'flex',gap:8,justifyContent:'flex-end'}}>
              <button onClick={()=>setShowModal(false)} style={btnG}>Cancel</button>
              <button onClick={save} disabled={saving} style={btnP}>{saving?'Saving…':'✓ Save to Brevo'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
