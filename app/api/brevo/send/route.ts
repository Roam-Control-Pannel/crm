import { NextRequest, NextResponse } from 'next/server';
import { sendTransactionalEmail, updateContact } from '@/lib/brevo';
import { getAppSettings } from '@/lib/app-settings';
import { renderSequenceEmail, type SequenceStep } from '@/lib/email-template';

export async function POST(req:NextRequest){
  try {
    const {email,businessName,town,knownFor,step}=await req.json();
    if(!email||!businessName||!town) return NextResponse.json({error:'missing required fields'},{status:400});
    // Pull sender + editable templates from settings each send so changes made
    // on the /sequences and Settings pages propagate without a redeploy.
    const { sender, templates } = await getAppSettings();
    const stepNum = ([1, 2, 3].includes(step) ? step : 1) as SequenceStep;
    const tpl = templates[`step${stepNum}` as const];
    const {subject,htmlContent}=renderSequenceEmail(tpl,{
      businessName,
      town,
      knownFor: knownFor || 'its independent spirit',
    });
    await sendTransactionalEmail({to:[{email,name:businessName}],subject,htmlContent,senderName:sender.name,senderEmail:sender.email,replyToEmail:sender.replyTo});

    // Update LAST_CONTACT_DATE so cron can calculate follow-up timing.
    // Routed through lib/brevo so failures throw rather than silently
    // breaking follow-up scheduling.
    const today = new Date().toISOString().split('T')[0];
    let contactUpdated = true;
    try {
      await updateContact(email, { LAST_CONTACT_DATE: today });
    } catch (err) {
      contactUpdated = false;
      console.error('[brevo/send] failed to update LAST_CONTACT_DATE', err);
    }

    return NextResponse.json({success:true,step,email,contactUpdated});
  } catch(error:unknown){
    const message=error instanceof Error?error.message:'Failed to send email';
    return NextResponse.json({error:message},{status:500});
  }
}
