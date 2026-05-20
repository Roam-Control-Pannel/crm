import { NextRequest, NextResponse } from 'next/server';
import { sendTransactionalEmail, updateContact } from '@/lib/brevo';
import { getAppSettings } from '@/lib/app-settings';

const signature = `
<table style="margin-top:24px;padding-top:16px;border-top:1px solid #e4d8dc;font-family:Arial,sans-serif">
  <tr>
    <td style="padding-right:16px;vertical-align:top">
      <img src="https://roam-local.co.uk/icon.png" width="40" height="40" style="border-radius:8px" alt="Roam"/>
    </td>
    <td style="vertical-align:top">
      <div style="font-weight:700;font-size:13px;color:#1a0d12">Roam Local Team</div>
      <div style="font-size:12px;color:#6b4a55;margin-top:2px">Discover the best of your town</div>
      <div style="margin-top:6px">
        <a href="https://roam-local.co.uk" style="font-size:11px;color:#8B1A3A;text-decoration:none;font-family:Arial,sans-serif">roam-local.co.uk</a>
        <span style="color:#e4d8dc;margin:0 6px">|</span>
        <a href="https://roam-local.co.uk" style="font-size:11px;color:#8B1A3A;text-decoration:none;font-family:Arial,sans-serif">List your business free</a>
      </div>
    </td>
  </tr>
</table>`;

function buildEmail(step:number,businessName:string,town:string,knownFor:string){
  const subjects:Record<number,string>={
    1:`Free listing for ${businessName} on Roam`,
    2:`Just checking in — ${town} on Roam`,
    3:`Last one from us — ${businessName}`,
  };
  const bodies:Record<number,string>={
    1:`<div style="font-family:Arial,sans-serif;max-width:560px;color:#1a0d12">
  <p>Hi there,</p>
  <p>We've built a dedicated page for <strong>${town}</strong> on Roam — a free local discovery app helping people find the best independent businesses in their area.</p>
  <p>${town} is known for ${knownFor}, and we'd love <strong>${businessName}</strong> to be one of the first businesses featured.</p>
  <p>Listing takes <strong>90 seconds</strong> and is completely free — no subscription, no catch.</p>
  <p style="margin-top:20px"><a href="https://roam-local.co.uk" style="background:#8B1A3A;color:white;padding:12px 24px;border-radius:6px;text-decoration:none;display:inline-block;font-weight:700;font-family:Arial,sans-serif">List ${businessName} for free →</a></p>
  <p style="margin-top:16px">Any questions, just reply to this email.</p>
  <p>Best wishes,</p>
  ${signature}
</div>`,
    2:`<div style="font-family:Arial,sans-serif;max-width:560px;color:#1a0d12">
  <p>Hi there,</p>
  <p>Just a quick follow-up — we'd love to have <strong>${businessName}</strong> on Roam's <strong>${town}</strong> page.</p>
  <p>It's completely free and takes 90 seconds. Businesses across ${town} are already signing up.</p>
  <p style="margin-top:20px"><a href="https://roam-local.co.uk" style="background:#8B1A3A;color:white;padding:12px 24px;border-radius:6px;text-decoration:none;display:inline-block;font-weight:700;font-family:Arial,sans-serif">Get listed now →</a></p>
  <p>Best wishes,</p>
  ${signature}
</div>`,
    3:`<div style="font-family:Arial,sans-serif;max-width:560px;color:#1a0d12">
  <p>Hi there,</p>
  <p>We won't chase again after this — promise!</p>
  <p>If you'd like <strong>${businessName}</strong> featured on Roam's <strong>${town}</strong> page for free, it only takes 90 seconds.</p>
  <p style="margin-top:20px"><a href="https://roam-local.co.uk" style="background:#8B1A3A;color:white;padding:12px 24px;border-radius:6px;text-decoration:none;display:inline-block;font-weight:700;font-family:Arial,sans-serif">List for free →</a></p>
  <p>Best wishes,</p>
  ${signature}
</div>`,
  };
  return {subject:subjects[step]||subjects[1],htmlContent:bodies[step]||bodies[1]};
}

export async function POST(req:NextRequest){
  try {
    const {email,businessName,town,knownFor,step}=await req.json();
    if(!email||!businessName||!town) return NextResponse.json({error:'missing required fields'},{status:400});
    const {subject,htmlContent}=buildEmail(step||1,businessName,town,knownFor||'its independent spirit');
    // Pull sender from settings each send so the Settings page changes
    // propagate without a redeploy. Defaults match the previous constants.
    const { sender } = await getAppSettings();
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
