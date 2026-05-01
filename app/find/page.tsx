'use client';
import {useState} from 'react';
interface Result {name:string;address:string;rating?:number;source:string;town:string;email:string;website:string;phone:string;selected:boolean;}
const inp:React.CSSProperties={padding:'9px 12px',border:'1.5px solid #e4d8dc',borderRadius:8,fontSize:13,fontFamily:'Nunito Sans,sans-serif',background:'#fff',color:'#1a0d12',outline:'none',width:'100%'};
const btnP:React.CSSProperties={display:'inline-flex',alignItems:'center',gap:6,padding:'9px 20px',borderRadius:8,fontSize:13,fontWeight:700,cursor:'pointer',border:'none',fontFamily:'Nunito Sans,sans-serif',background:'linear-gradient(135deg,#6B1230,#8B1A3A)',color:'#fff',boxShadow:'0 2px 8px rgba(139,26,58,0.28)'};
export default function FindPage() {
  const [town,setTown]=useState('');
  const [type,setType]=useState('restaurants');
  const [limit,setLimit]=useState('20');
  const [sources,setSources]=useState({google:true,yell:true});
  const [loading,setLoading]=useState(false);
  const [progress,setProgress]=useState(0);
  const [msg,setMsg]=useState('');
  const [results,setResults]=useState<Result[]>([]);
  const [importing,setImporting]=useState(false);
  const [done,setDone]=useState(false);
  async function runSearch() {
    if(!town.trim())return;
    setLoading(true);setResults([]);setDone(false);setProgress(0);
    const all:Result[]=[];
    if(sources.google){
      setMsg('Searching Google Places…');setProgress(20);
      try{const d=await fetch(`/api/places?town=${encodeURIComponent(town)}&type=${type}&limit=${limit}`).then(r=>r.json());
      if(d.results)all.push(...d.results.map((r:Omit<Result,'selected'>)=>({...r,selected:true})));setProgress(55);}catch(e){console.error(e);}
    }
    if(sources.yell){
      setMsg('Scraping Yell.com…');setProgress(70);
      try{const d=await fetch(`/api/scrape/yell?town=${encodeURIComponent(town)}&type=${type}&limit=${limit}`).then(r=>r.json());
      if(d.results)all.push(...d.results.map((r:Omit<Result,'selected'>)=>({...r,selected:true})));setProgress(90);}catch(e){console.error(e);}
    }
    const deduped=all.filter((r,i,a)=>a.findIndex(x=>x.name.toLowerCase()===r.name.toLowerCase())===i);
    setMsg(`Found ${deduped.length} businesses in ${town}`);setProgress(100);
    setResults(deduped);setLoading(false);
  }
  async function importSelected() {
    const sel=results.filter(r=>r.selected);
    if(!sel.length)return;
    setImporting(true);
    for(const r of sel){
      const email=r.email||`info@${r.name.toLowerCase().replace(/[^a-z0-9]/g,'')}.co.uk`;
      await fetch('/api/brevo/contacts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:r.name,email,town:r.town,source:r.source,status:'not_contacted',website:r.website||'',phone:r.phone||''})});
    }
    setImporting(false);setDone(true);
  }
  const toggle=(i:number)=>setResults(p=>p.map((r,idx)=>idx===i?{...r,selected:!r.selected}:r));
  const toggleAll=(v:boolean)=>setResults(p=>p.map(r=>({...r,selected:v})));
  return (
    <div style={{padding:'22px 24px'}}>
      <div style={{marginBottom:20}}>
        <h1 style={{fontFamily:'Nunito,sans-serif',fontSize:22,fontWeight:900,color:'#1a0d12',margin:0}}>Find Businesses</h1>
        <p style={{fontSize:12,color:'#9e7e88',margin:'3px 0 0',fontWeight:500}}>Pull listings from Google Places and Yell.com · review and import to Brevo</p>
      </div>
      <div style={{background:'linear-gradient(135deg,#f9eaee,#fff5f7)',border:'1.5px solid rgba(139,26,58,0.2)',borderRadius:12,padding:'18px 20px',marginBottom:20}}>
        <div style={{fontFamily:'Nunito,sans-serif',fontSize:14,fontWeight:800,marginBottom:4}}>⚡ Business Finder</div>
        <div style={{fontSize:12,color:'#6b4a55',marginBottom:16,fontWeight:500}}>Enter a town to find local businesses. You review results before anything is added to your contacts.</div>
        <div style={{display:'flex',gap:12,flexWrap:'wrap',alignItems:'flex-end'}}>
          <div style={{flex:1,minWidth:160}}>
            <label style={{display:'block',fontSize:11,fontWeight:700,color:'#6b4a55',marginBottom:5}}>Town</label>
            <input value={town} onChange={e=>setTown(e.target.value)} onKeyDown={e=>e.key==='Enter'&&runSearch()} placeholder="e.g. Whitstable, Kent" style={inp}/>
          </div>
          <div style={{minWidth:160}}>
            <label style={{display:'block',fontSize:11,fontWeight:700,color:'#6b4a55',marginBottom:5}}>Type</label>
            <select value={type} onChange={e=>setType(e.target.value)} style={{...inp,cursor:'pointer'}}>
              <option value="restaurants">Restaurants & Food</option>
              <option value="cafes">Cafés & Coffee</option>
              <option value="pubs">Pubs & Bars</option>
              <option value="shops">Retail & Shops</option>
              <option value="hotels">Accommodation</option>
              <option value="businesses">All Businesses</option>
            </select>
          </div>
          <div style={{minWidth:100}}>
            <label style={{display:'block',fontSize:11,fontWeight:700,color:'#6b4a55',marginBottom:5}}>Max</label>
            <select value={limit} onChange={e=>setLimit(e.target.value)} style={{...inp,cursor:'pointer'}}>
              <option value="10">10</option><option value="15">15</option><option value="20">20</option>
            </select>
          </div>
          <div>
            <label style={{display:'block',fontSize:11,fontWeight:700,color:'#6b4a55',marginBottom:5}}>Sources</label>
            <div style={{display:'flex',gap:6}}>
              {(['google','yell'] as const).map(s=>(
                <button key={s} onClick={()=>setSources(p=>({...p,[s]:!p[s]}))} style={{padding:'8px 14px',border:'1.5px solid #e4d8dc',borderRadius:8,fontSize:12,fontWeight:700,cursor:'pointer',background:sources[s]?'#8B1A3A':'#fff',color:sources[s]?'#fff':'#6b4a55',fontFamily:'Nunito Sans,sans-serif'}}>
                  {s==='google'?'🌐 Google':'📋 Yell'}
                </button>
              ))}
            </div>
          </div>
          <button onClick={runSearch} disabled={loading||!town.trim()} style={{...btnP,opacity:loading||!town.trim()?0.6:1}}>
            {loading?'Searching…':'⚡ Find'}
          </button>
        </div>
        {progress>0&&(
          <div style={{marginTop:16}}>
            <div style={{display:'flex',justifyContent:'space-between',fontSize:11,fontWeight:700,color:'#6b4a55',marginBottom:6}}><span>{msg}</span><span>{progress}%</span></div>
            <div style={{background:'#e4d8dc',borderRadius:20,height:8,overflow:'hidden'}}>
              <div style={{height:8,borderRadius:20,background:'linear-gradient(90deg,#6B1230,#C44060)',width:`${progress}%`,transition:'width 0.4s ease'}}/>
            </div>
          </div>
        )}
      </div>
      {results.length>0&&(
        <div style={{background:'#fff',border:'1px solid #e4d8dc',borderRadius:12,overflow:'hidden'}}>
          <div style={{padding:'15px 20px',borderBottom:'1px solid #e4d8dc',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
            <div style={{fontFamily:'Nunito,sans-serif',fontSize:14,fontWeight:800}}>
              ✓ {results.length} businesses found in {town}
              {done&&<span style={{marginLeft:8,fontSize:11,color:'#2d7a4f',fontWeight:700}}>✓ Imported to Brevo!</span>}
            </div>
            <div style={{display:'flex',gap:8,alignItems:'center'}}>
              <button onClick={()=>toggleAll(true)} style={{fontSize:11,fontWeight:700,color:'#8B1A3A',background:'none',border:'none',cursor:'pointer'}}>All</button>
              <button onClick={()=>toggleAll(false)} style={{fontSize:11,fontWeight:700,color:'#9e7e88',background:'none',border:'none',cursor:'pointer'}}>None</button>
              <button onClick={importSelected} disabled={importing||done} style={{...btnP,fontSize:11,padding:'6px 14px',opacity:importing||done?0.6:1}}>
                {importing?'Importing…':done?'✓ Done!':'➕ Import to Brevo'}
              </button>
            </div>
          </div>
          <div style={{overflowX:'auto'}}>
            <table style={{width:'100%',borderCollapse:'collapse'}}>
              <thead><tr>{['','Business','Address','Rating','Source'].map(h=><th key={h} style={{padding:'10px 14px',textAlign:'left',fontSize:10,fontWeight:800,letterSpacing:1,textTransform:'uppercase',color:'#9e7e88',borderBottom:'2px solid #e4d8dc'}}>{h}</th>)}</tr></thead>
              <tbody>
                {results.map((r,i)=>(
                  <tr key={i} style={{borderBottom:'1px solid #e4d8dc',background:r.selected?'#f9eaee':'#fff'}}>
                    <td style={{padding:'12px 14px'}}><input type="checkbox" checked={r.selected} onChange={()=>toggle(i)}/></td>
                    <td style={{padding:'12px 14px'}}><div style={{fontSize:13,fontWeight:700}}>{r.name}</div></td>
                    <td style={{padding:'12px 14px',fontSize:11,color:'#9e7e88',maxWidth:220}}>{r.address}</td>
                    <td style={{padding:'12px 14px',fontSize:12,fontWeight:700,color:'#b06820'}}>{r.rating?`${r.rating} ★`:'—'}</td>
                    <td style={{padding:'12px 14px'}}><span style={{fontSize:9,fontWeight:700,padding:'2px 8px',borderRadius:20,background:r.source==='google'?'#e4f2fb':'#fdf0e4',color:r.source==='google'?'#1a6b9a':'#b06820'}}>{r.source==='google'?'Google':'Yell'}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
