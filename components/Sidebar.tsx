'use client';
import { usePathname, useRouter } from 'next/navigation';

const nav = [
  { section:'Overview', items:[
    { label:'Dashboard', icon:'◈', href:'/' },
    { label:"Today's Queue", icon:'✓', href:'/queue', badge:14 },
  ]},
  { section:'Businesses', items:[
    { label:'Contact Manager', icon:'🏪', href:'/contacts' },
    { label:'Find Businesses', icon:'⚡', href:'/find' },
    { label:'Email Sequences', icon:'✉', href:'/sequences' },
  ]},
  { section:'Content', items:[
    { label:'Social Posts', icon:'↑', href:'/social' },
  ]},
  { section:'Settings', items:[
    { label:'Channels', icon:'⚙', href:'/channels' },
  ]},
];

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  return (
    <aside style={{width:240,background:'#1a0d12',position:'fixed',top:0,left:0,bottom:0,zIndex:200,display:'flex',flexDirection:'column',overflow:'hidden'}}>
      <div style={{position:'absolute',top:-60,left:-60,width:220,height:220,background:'radial-gradient(circle,rgba(139,26,58,0.3) 0%,transparent 70%)',pointerEvents:'none'}}/>
      <div style={{padding:'20px 18px 18px',borderBottom:'1px solid rgba(255,255,255,0.08)'}}>
        <div style={{display:'flex',alignItems:'center',gap:10}}>
          <div style={{width:36,height:36,background:'linear-gradient(135deg,#6B1230,#8B1A3A)',borderRadius:9,display:'flex',alignItems:'center',justifyContent:'center',fontSize:17,boxShadow:'0 2px 8px rgba(139,26,58,0.4)',flexShrink:0}}>🦁</div>
          <div>
            <div style={{fontFamily:'Nunito,sans-serif',fontWeight:900,fontSize:19,color:'#fff',letterSpacing:-0.5}}>roam</div>
            <div style={{fontSize:8.5,fontWeight:700,letterSpacing:2,textTransform:'uppercase',color:'rgba(255,255,255,0.28)',marginTop:1}}>Growth Engine</div>
          </div>
        </div>
      </div>
      <nav style={{padding:'14px 0',flex:
