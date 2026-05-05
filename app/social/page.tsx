'use client';
import {useState,useEffect} from 'react';
import {Plus,Calendar,List,Briefcase,MessageCircle,X,Image,Sparkles,ChevronLeft,ChevronRight,Check,Clock,Edit3,Trash2,Camera} from 'lucide-react';
import {addNotification} from '@/components/NotificationCentre';

export default function SocialPage(){
  const [tab,setTab]=useState<'calendar'|'list'>('calendar');
  return(
    <div style={{padding:'24px 28px'}}>
      <h1>Social Calendar — coming soon</h1>
    </div>
  );
}