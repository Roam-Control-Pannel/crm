'use client';
import {useState,useCallback} from 'react';

interface BrevoList {id:number;name:string;}
interface Result {
  name:string;address:string;rating?:number;
  source:string;town:string;
  email:string;website:string;phone:string;
  placeId?:string;selected:boolean;
  enriching?:boolean;enriched?:boolean;
}

const inp:React.CSSProperties={padding:'8px 12px',border:'1.5px solid var(--ink-200)',borderRadius:'var(--r-md)',fontSize:13,fontFamily:'inherit',background:'var(--white)',color:'var(--ink-900)',outline:'none',width:'100%'};
const btnP:React.CSSProperties={display:'inline-flex',alignItems:'center',gap:6,padding:'9px 18px',borderRadius:'var(--r-md)',fontSize:13,fontWeight:600,cursor:'pointer',border:'none',fontFamily:'inherit',background:'var(--maroon-700)',color:'#fff',whiteSpace:'nowrap' as const};
const btnS:React.CSSProperties={display:'inline-flex',alignItems:'center',gap:6,padding:'7px 14px',borderRadius:'var(--r-md)',fontSize:12,fontWeight:600,cursor:'pointer',border:'none',fontFamily:'inherit',background:'var(--ok)',color:'#fff'};
const btnG:React.CSSProperties={display:'inline-flex',alignItems:'center',gap:6,padding:'7px 12px',borderRadius:'var(--r-md)',fontSize:12,fontWeight:600,cursor:'pointer',fontFamily:'inherit',background:'var(--white)',color:'var(--ink-600)',border:'1.5px solid var(--ink-200)'};

export default function FindPage() {
  const [town,setTown]=useState('');
  const [type,setType]=useState('restaurants');
  const [limit,setLimit]=useState('20');
  const [loading,setLoading]=useState(false);
  const [enriching,setEnriching]=useState(false);
  const [progress,setProgress]=useState(0);
  const [msg,setMsg]=useState('');
  const [results,setResults]=useState<Result[]>([]);
  const [lists,setLists]=useState<BrevoList[]>([]);
  const [selectedList,setSelectedList]=useState('');
  const [importing,setImporting]=useState(false);
  const [done,setDone]=useState(false);
  const [importCount,setImportCount]=useState(0);
  const [showCreateList,setShowCreateList]=useState(false);
  const [newListName,setNewListName]=useState('');
  const [creatingList,setCreatingList]=useState(false);

  async function runSearch(){
    if(!town.trim())return;
    setLoading(true);setResults([]);setDone(false);setProgress(10);setMsg('Searching Google Places…');
    try{
      const d=await fetch(`/api/places?town=${encodeURIComponent(town)}&type=${type}&limit=${limit}`).then(r=>r.json());
      const found=(d.results||[]).map((r:Omit<Result,'selected'|'enriching'|'enriched'>)=>({...r,selected:true,enriched:false}));
      setProgress(100);setMsg(`Found ${found.length} businesses in ${town}`);setResults(found);
      setNewListName(`${town} — Roam Outreach`);
      fetch('/api/brevo/lists').then(r=>r.json()).then(d=>setLists(d.lists||[])).catch(()=>{});
    }catch(e){setMsg('Search failed — please try again');console.error(e);}
    setLoading(false);
  }

  const enrichAll=useCallback(async()=>{
    if(enriching)return;
    setEnriching(true);
    const snap=[...results];
    for(let i=0;i<snap.length;i++){
      const r=snap[i];
      if(r.enriched||!r.placeId)continue;
      setResults(prev=>prev.map((x,idx)=>idx===i?{...x,enriching:true}:x));
      try{
        const details=await fetch(`/api/places/enrich?placeId=${r.placeId}`).then(d=>d.json());
        let email=r.email;
        const website=details.website||r.website;
        const phone=details.phone||r.phone;
        if(website&&!email){
          const scraped=await fetch(`/api/scrape/email?website=${encodeURIComponent(website)}`).then(d=>d.json());
          if(scraped.email)email=scraped.email;
        }
        // After enrichment, auto-deselect rows we couldn't find an email
        // for. They become "needs research" — user can paste an email and
        // re-select, or skip.
        setResults(prev=>prev.map((x,idx)=>idx===i?{...x,phone,website,email,enriching:false,enriched:true,selected:!!email}:x));
      }catch{setResults(prev=>prev.map((x,idx)=>idx===i?{...x,enriching:false,enriched:true}:x));}
    }
    setEnriching(false);
  },[results,enriching]);

  async function createList(){
    if(!newListName.trim())return;
    setCreatingList(true);
    try{
      const res=await fetch('/api/brevo/lists',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:newListName.trim()})});
      const data=await res.json();
      if(data.id){setLists(prev=>[{id:data.id,name:newListName.trim()},...prev]);setSelectedList(String(data.id));setShowCreateList(false);}
    }catch(e){console.error(e);}
    setCreatingList(false);
  }

  async function importSelected(){
    const sel=results.filter(r=>r.selected&&r.email);
    if(!sel.length)return;
    setImporting(true);setImportCount(0);
    const listIds=selectedList?[Number(selectedList)]:[];
    let count=0;
    for(const r of sel){
      try{
        await fetch('/api/brevo/contacts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:r.name,email:r.email,town:r.town,source:'google',status:'not_contacted',website:r.website||'',phone:r.phone||'',listIds})});
        count++;setImportCount(count);
      }catch(e){console.error(e);}
    }
    setImporting(false);setDone(true);
  }

  const setEmailFor=(i:number,v:string)=>{
    const trimmed=v.trim().toLowerCase();
    setResults(p=>p.map((r,idx)=>idx===i?{...r,email:trimmed,selected:trimmed?true:r.selected}:r));
  };

  const toggle=(i:number)=>setResults(p=>p.map((r,idx)=>idx===i?{...r,selected:!r.selected}:r));
  const toggleAll=(v:boolean)=>setResults(p=>p.map(r=>({...r,selected:v})));
  const enrichedCount=results.filter(r=>r.enriched).length;
  const emailCount=results.filter(r=>r.email).length;
  const phoneCount=results.filter(r=>r.phone).length;
  const needsResearchCount=results.filter(r=>r.enriched&&!r.email).length;
  const selectedListObj=lists.find(l=>l.id===Number(selectedList));

  return (
    <div style={{padding:'24px 28px'}}>
      {/* Header */}
      <div style={{marginBottom:20}}>
        <h1 style={{fontFamily:'var(--font-display)',fontSize:28,fontWeight:400,color:'var(--ink-900)',lineHeight:1}}>Find Businesses</h1>
        <p style={{fontSize:12,color:'var(--ink-400)',marginTop:5,fontWeight:500}}>Search Google Places · enrich with phone, website and email · import to Brevo</p>
      </div>

      {/* Search card */}
      <div style={{background:'linear-gradient(135deg,var(--maroon-50),var(--white))',border:'1.5px solid rgba(112,32,64,0.15)',borderRadius:'var(--r-lg)',padding:'18px 20px',marginBottom:20}}>
        <div style={{fontFamily:'var(--font-display)',fontSize:18,color:'var(--ink-900)',marginBottom:4}}>⚡ Business Finder</div>
        <div style={{fontSize:12,color:'var(--ink-500)',marginBottom:16,fontWeight:500}}>Find local businesses, enrich with contact details, then import directly to Brevo.</div>

        {/* All inputs in one row */}
        <div style={{display:'flex',gap:10,alignItems:'flex-end',flexWrap:'wrap'}}>
          <div style={{flex:2,minWidth:180}}>
            <label style={{display:'block',fontSize:10.5,fontWeight:600,color:'var(--ink-500)',letterSpacing:'0.08em',textTransform:'uppercase',marginBottom:5}}>Town *</label>
            <input value={town} onChange={e=>setTown(e.target.value)} onKeyDown={e=>e.key==='Enter'&&runSearch()} placeholder="e.g. Darlington, Whitstable, Aberfeldy" style={inp}/>
          </div>
          <div style={{flex:1,minWidth:160}}>
            <label style={{display:'block',fontSize:10.5,fontWeight:600,color:'var(--ink-500)',letterSpacing:'0.08em',textTransform:'uppercase',marginBottom:5}}>Type</label>
            <select value={type} onChange={e=>setType(e.target.value)} style={{...inp,cursor:'pointer'}}>
              <option value="restaurants">Restaurants & Food</option>
              <option value="cafes">Cafés & Coffee</option>
              <option value="pubs">Pubs & Bars</option>
              <option value="shops">Retail & Shops</option>
              <option value="hotels">Accommodation</option>
              <option value="activities">Activities</option>
              <option value="businesses">All Businesses</option>
            </select>
          </div>
          <div style={{width:90}}>
            <label style={{display:'block',fontSize:10.5,fontWeight:600,color:'var(--ink-500)',letterSpacing:'0.08em',textTransform:'uppercase',marginBottom:5}}>Max</label>
            <select value={limit} onChange={e=>setLimit(e.target.value)} style={{...inp,cursor:'pointer'}}>
              <option value="10">10</option>
              <option value="15">15</option>
              <option value="20">20</option>
            </select>
          </div>
          <button onClick={runSearch} disabled={loading||!town.trim()} style={{...btnP,opacity:loading||!town.trim()?0.6:1}}>
            {loading?'Searching…':'⚡ Find'}
          </button>
        </div>

        {progress>0&&(
          <div style={{marginTop:14}}>
            <div style={{display:'flex',justifyContent:'space-between',fontSize:11,color:'var(--ink-500)',marginBottom:5}}>
              <span>{msg}</span><span style={{fontWeight:600}}>{progress}%</span>
            </div>
            <div style={{background:'var(--ink-200)',borderRadius:'var(--r-pill)',height:6,overflow:'hidden'}}>
              <div style={{height:'100%',width:`${progress}%`,borderRadius:'var(--r-pill)',background:'linear-gradient(90deg,var(--maroon-700),var(--maroon-500))',transition:'width 0.4s ease'}}/>
            </div>
          </div>
        )}
      </div>

      {/* Results */}
      {results.length>0&&(
        <div style={{background:'var(--white)',borderRadius:'var(--r-lg)',boxShadow:'var(--shadow-sm)',overflow:'hidden'}}>
          {/* Results header */}
          <div style={{padding:'14px 18px',borderBottom:'1px solid var(--ink-100)'}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:10,marginBottom:enrichedCount>0?10:0}}>
              <div style={{fontFamily:'var(--font-display)',fontSize:17,color:'var(--ink-900)'}}>
                ✓ {results.length} businesses in {town}
                {done&&<span style={{marginLeft:10,fontSize:12,color:'var(--ok)',fontWeight:600}}>✓ {importCount} imported!</span>}
              </div>
              <div style={{display:'flex',gap:8,alignItems:'center'}}>
                <button onClick={()=>toggleAll(true)} style={{fontSize:11,fontWeight:600,color:'var(--maroon-600)',background:'none',border:'none',cursor:'pointer'}}>Select All</button>
                <span style={{color:'var(--ink-300)'}}>·</span>
                <button onClick={()=>toggleAll(false)} style={{fontSize:11,fontWeight:600,color:'var(--ink-400)',background:'none',border:'none',cursor:'pointer'}}>None</button>
                {!enriching&&enrichedCount<results.length&&(
                  <button onClick={enrichAll} style={btnS}>✦ Enrich Data</button>
                )}
                {enriching&&<span style={{fontSize:11,color:'var(--ok)',fontWeight:600}}>⟳ Enriching {enrichedCount}/{results.length}…</span>}
              </div>
            </div>
            {enrichedCount>0&&(
              <div style={{display:'flex',gap:16,fontSize:11,fontWeight:600,marginBottom:10}}>
                <span style={{color:'var(--ok)'}}>✓ {enrichedCount} enriched</span>
                <span style={{color:'var(--info)'}}>✉ {emailCount} emails</span>
                <span style={{color:'var(--warn)'}}>📞 {phoneCount} phones</span>
                {needsResearchCount>0&&<span style={{color:'var(--alert)'}}>⚠ {needsResearchCount} need research</span>}
              </div>
            )}
            {/* Import bar */}
            <div style={{background:'var(--paper)',borderRadius:'var(--r-md)',padding:'10px 12px',display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
              <span style={{fontSize:11.5,fontWeight:600,color:'var(--ink-500)',flexShrink:0}}>Import to:</span>
              <select value={selectedList} onChange={e=>setSelectedList(e.target.value)} style={{...inp,fontSize:12,padding:'6px 10px',flex:1,minWidth:180,cursor:'pointer'}}>
                <option value="">No list assignment</option>
                {lists.map(l=><option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
              <button onClick={()=>setShowCreateList(true)} style={{...btnG,fontSize:11,padding:'6px 10px',flexShrink:0}}>📋 New List</button>
              {selectedListObj&&<span style={{fontSize:11,color:'var(--ok)',fontWeight:600,flexShrink:0}}>→ {selectedListObj.name}</span>}
              <button onClick={importSelected} disabled={importing||done||!results.some(r=>r.selected&&r.email)} style={{...btnP,fontSize:11.5,padding:'7px 14px',marginLeft:'auto',opacity:importing||done||!results.some(r=>r.selected&&r.email)?0.6:1}}>
                {importing?`Importing ${importCount}…`:done?'✓ Done!':`➕ Import ${results.filter(r=>r.selected&&r.email).length} to Brevo`}
              </button>
            </div>
          </div>

          {/* Results table */}
          <div style={{overflowX:'auto'}}>
            <table style={{width:'100%',borderCollapse:'collapse'}}>
              <thead>
                <tr>{['','Business','Phone','Email','Rating',''].map((h,i)=>(
                  <th key={i} style={{padding:'10px 14px',textAlign:'left',fontSize:9.5,fontWeight:600,letterSpacing:'0.1em',textTransform:'uppercase',color:'var(--ink-400)',borderBottom:'1.5px solid var(--ink-100)'}}>{h}</th>
                ))}</tr>
              </thead>
              <tbody>
                {results.map((r,i)=>(
                  <tr key={i} style={{borderBottom:'1px solid var(--ink-100)',background:r.selected?'var(--maroon-50)':'var(--white)',transition:'background 0.15s'}}>
                    <td style={{padding:'11px 14px'}}><input type="checkbox" checked={r.selected} onChange={()=>toggle(i)} style={{accentColor:'var(--maroon-700)',width:14,height:14}}/></td>
                    <td style={{padding:'11px 14px'}}>
                      <div style={{fontSize:13,fontWeight:600,color:'var(--ink-900)'}}>{r.name}</div>
                      <div style={{fontSize:10.5,color:'var(--ink-400)',marginTop:1}}>{r.address}</div>
                      {r.website&&<a href={r.website} target="_blank" rel="noreferrer" style={{fontSize:10.5,color:'var(--info)',textDecoration:'none',display:'block',marginTop:1}}>🌐 {r.website.replace(/https?:\/\//,'').slice(0,35)}</a>}
                    </td>
                    <td style={{padding:'11px 14px',fontSize:12,color:'var(--ink-800)',fontWeight:500,minWidth:120}}>
                      {r.enriching?<span style={{color:'var(--ink-300)',fontSize:11}}>⟳ finding…</span>:r.phone||<span style={{color:'var(--ink-200)'}}>—</span>}
                    </td>
                    <td style={{padding:'11px 14px',fontSize:12,color:'var(--info)',fontWeight:500,minWidth:200}}>
                      {r.enriching?(
                        <span style={{color:'var(--ink-300)',fontSize:11}}>⟳ finding…</span>
                      ):r.email?(
                        <input
                          type="email"
                          value={r.email}
                          onChange={e=>setEmailFor(i,e.target.value)}
                          style={{...inp,padding:'5px 8px',fontSize:12,color:'var(--info)',fontWeight:500,border:'1px solid transparent',background:'transparent',width:'100%'}}
                          onFocus={e=>{e.currentTarget.style.border='1px solid var(--ink-200)';e.currentTarget.style.background='var(--white)';}}
                          onBlur={e=>{e.currentTarget.style.border='1px solid transparent';e.currentTarget.style.background='transparent';}}
                        />
                      ):r.enriched?(
                        <div style={{display:'flex',gap:6,alignItems:'center',flexWrap:'wrap'}}>
                          <span style={{fontSize:10,fontWeight:700,color:'var(--warn)',background:'#fdf0e4',padding:'2px 8px',borderRadius:'var(--r-pill)',letterSpacing:'0.04em',textTransform:'uppercase'}}>Needs research</span>
                          <input
                            type="email"
                            placeholder="paste email here"
                            onChange={e=>setEmailFor(i,e.target.value)}
                            style={{...inp,padding:'4px 8px',fontSize:11,flex:1,minWidth:120}}
                          />
                        </div>
                      ):(
                        <span style={{color:'var(--ink-200)'}}>—</span>
                      )}
                    </td>
                    <td style={{padding:'11px 14px',fontSize:12,fontWeight:600,color:'var(--warn)'}}>{r.rating?`${r.rating} ★`:'—'}</td>
                    <td style={{padding:'11px 14px'}}>
                      <button onClick={()=>toggle(i)} style={{fontSize:10.5,fontWeight:600,color:r.selected?'var(--maroon-600)':'var(--ok)',background:'none',border:'none',cursor:'pointer'}}>
                        {r.selected?'Deselect':'Select'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Create List Modal */}
      {showCreateList&&(
        <div style={{position:'fixed',inset:0,background:'rgba(26,13,18,0.5)',zIndex:500,display:'flex',alignItems:'center',justifyContent:'center',backdropFilter:'blur(4px)'}} onClick={e=>{if(e.target===e.currentTarget)setShowCreateList(false);}}>
          <div style={{background:'var(--white)',borderRadius:'var(--r-xl)',width:460,maxWidth:'95vw',boxShadow:'var(--shadow-lg)'}}>
            <div style={{padding:'20px 24px 16px',borderBottom:'1px solid var(--ink-100)',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
              <div style={{fontFamily:'var(--font-display)',fontSize:20,color:'var(--ink-900)'}}>📋 Create New List</div>
              <button onClick={()=>setShowCreateList(false)} style={{width:28,height:28,borderRadius:'var(--r-xs)',border:'1.5px solid var(--ink-200)',background:'var(--white)',fontSize:16,cursor:'pointer',color:'var(--ink-500)'}}>✕</button>
            </div>
            <div style={{padding:'20px 24px'}}>
              <div style={{fontSize:12,color:'var(--ink-400)',marginBottom:14,lineHeight:1.6}}>Creates a new list in Brevo and auto-selects it for import.</div>
              <label style={{display:'block',fontSize:11.5,fontWeight:600,color:'var(--ink-600)',marginBottom:6}}>List Name *</label>
              <input value={newListName} onChange={e=>setNewListName(e.target.value)} onKeyDown={e=>e.key==='Enter'&&createList()} placeholder="e.g. Whitstable — Roam Outreach" style={inp} autoFocus/>
              <div style={{marginTop:10,display:'flex',gap:6,flexWrap:'wrap'}}>
                {[`${town} — Roam Outreach`,`${town} — Restaurants`,`${town} — All Businesses`].filter(()=>town).map(s=>(
                  <button key={s} onClick={()=>setNewListName(s)} style={{fontSize:10.5,padding:'3px 10px',borderRadius:'var(--r-pill)',border:'1.5px solid var(--ink-200)',background:newListName===s?'var(--maroon-50)':'var(--paper)',cursor:'pointer',fontFamily:'inherit',fontWeight:500,color:'var(--ink-600)'}}>{s}</button>
                ))}
              </div>
            </div>
            <div style={{padding:'16px 24px',borderTop:'1px solid var(--ink-100)',display:'flex',gap:8,justifyContent:'flex-end'}}>
              <button onClick={()=>setShowCreateList(false)} style={{...btnG}}>Cancel</button>
              <button onClick={createList} disabled={creatingList||!newListName.trim()} style={{...btnP,opacity:creatingList||!newListName.trim()?0.6:1}}>
                {creatingList?'Creating…':'✓ Create List'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
