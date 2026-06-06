import { createMimeMessage } from 'mimetext';
// @ts-ignore - provided by the Cloudflare Workers runtime
import { EmailMessage } from 'cloudflare:email';
import type { Application, Contact } from './schema';

const money = (n: number) => `$${Math.round(n || 0).toLocaleString('en-CA')}`;
const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const yn = (v: string) => (v === 'yes' ? 'Yes' : v === 'no' ? 'No' : v || '—');

export interface DocLink {
  type: string;
  name: string;
  url: string;
}

const TYPE_LABELS: Record<string, string> = {
  proofOfIncome: 'Proof of income',
  creditReport: 'Credit report',
  photoId: 'Government photo ID',
};

export function buildApplicationEmail(
  app: Application,
  docs: DocLink[],
  submissionId: string,
  docRequestUrl: string,
  docTtlDays: number
) {
  const a = app.applicant;
  const r = app.residence;
  const e = app.employment;
  const b = app.background;

  const subject = `New rental application — ${app.unitLabel || app.unit} — ${a.fullName}`;

  // ---- plain text ----
  const occText = app.occupants
    .map(
      (o, i) =>
        `  ${i + 1}. ${o.fullName} — DOB ${o.dob}${o.age != null ? ` (age ${o.age})` : ''}, ${o.relationship}` +
        `${o.isAdult ? `, ADULT, co-sign: ${yn(o.willCosign)}` : ''}` +
        `${o.willCosign === 'yes' ? ` [${o.cosignEmail} / ${o.cosignPhone}${o.cosignIncome ? `, income ${money(o.cosignIncome)}` : ''}]` : ''}`
    )
    .join('\n');

  const docText = docs.length
    ? docs.map((d) => `  - ${TYPE_LABELS[d.type] || d.type}: ${d.name}\n    ${d.url}`).join('\n')
    : '  (none)';

  const text = [
    `NEW RENTAL APPLICATION`,
    `Submission: ${submissionId}`,
    `Submitted: ${app.consent.signedAt}`,
    ``,
    `UNIT: ${app.unitLabel || app.unit}`,
    `Move-in: ${app.moveInDate} | Lease: ${app.leaseTerm} | Garage: ${yn(app.wantGarage)}`,
    ``,
    `APPLICANT`,
    `  ${a.fullName}${a.preferredName ? ` (prefers ${a.preferredName})` : ''}`,
    `  DOB: ${a.dob}`,
    `  ${a.email} | ${a.phone}${a.altPhone ? ` | ${a.altPhone}` : ''}`,
    ``,
    `RESIDENCE`,
    `  ${r.street}, ${r.city} ${r.province} ${r.postal}`,
    `  ${r.ownRent === 'rent' ? 'Renting' : r.ownRent}; since ${r.currentMoveIn || '—'}`,
    `  Reason for leaving: ${r.reasonLeaving}`,
    r.ownRent === 'rent'
      ? `  Landlord: ${r.landlordName} (${r.landlordPhone}${r.landlordEmail ? `, ${r.landlordEmail}` : ''}); contact OK: ${r.canContactLandlord}; current rent ${money(r.currentRent)}`
      : '',
    `  Evicted/notice for cause: ${yn(r.evicted)}${r.evictedExplain ? ` — ${r.evictedExplain}` : ''}`,
    `  Broke a lease: ${yn(r.brokeLease)}${r.brokeLeaseExplain ? ` — ${r.brokeLeaseExplain}` : ''}`,
    ...(r.previousResidences?.length
      ? ['  Previous residences:', ...r.previousResidences.map((p) => `    - ${p.street}, ${p.city} ${p.province} ${p.postal} (${p.from || '?'} → ${p.to || '?'})`)]
      : []),
    ``,
    `EMPLOYMENT & INCOME`,
    `  Status: ${e.status}${e.employer ? ` at ${e.employer}` : ''}${e.jobTitle ? ` (${e.jobTitle})` : ''}`,
    `  Tenure: ${e.lengthWithEmployer || '—'}${e.employerPhone ? ` | Employer phone: ${e.employerPhone}` : ''}`,
    `  Gross monthly income: ${money(e.grossMonthlyIncome)}${e.additionalIncome ? ` (+${money(e.additionalIncome)} additional household)` : ''}`,
    ``,
    `OCCUPANTS (${app.occupants.length})`,
    occText,
    ``,
    `BACKGROUND`,
    `  Pets: ${yn(b.hasPets)}${b.pets.length ? ` — ${b.pets.map((p) => `${p.type}${p.breed ? ` (${p.breed})` : ''}`).join(', ')}` : ''}`,
    `  Service/assistance animal: ${yn(b.serviceAnimal)}`,
    `  Smoking: ${b.smoking}`,
    `  Vehicles: ${b.vehicles.length ? b.vehicles.map((v) => `${v.makeModel} ${v.plate}${v.parkingNeeded ? ' (needs parking)' : ''}`).join('; ') : 'none'}`,
    `  Bankruptcy/proposal: ${b.bankruptcy || '—'}`,
    `  Guarantor: ${yn(b.hasGuarantor)}${b.hasGuarantor === 'yes' ? ` — ${b.guarantor.name}, ${b.guarantor.phone}, ${b.guarantor.email}` : ''}`,
    `  Emergency contacts:`,
    ...b.emergencyContacts.map((e) => `    - ${e.name} (${e.relationship}) ${e.phone}`),
    ``,
    `DOCUMENTS (links expire — download promptly)`,
    docText,
    ``,
    `CONSENTS (all confirmed)`,
    `  Accuracy: yes | No-fee ack: yes | Credit check: yes | Privacy (PIPA/PIPEDA): yes`,
    `  Electronic signature: ${app.consent.signature} @ ${app.consent.signedAt}`,
    ``,
    `NEXT STEP — IF YOU SHORTLIST THIS APPLICANT`,
    `  Government ID and a credit report are NOT collected up front. To request them,`,
    `  send the applicant this secure upload link (valid ${docTtlDays} days):`,
    `  ${docRequestUrl}`,
    `  Their reply will arrive as a separate "Shortlist documents received" email.`,
  ]
    .filter((l) => l !== '')
    .join('\n');

  // ---- HTML ----
  const row = (k: string, v: string) =>
    `<tr><td style="padding:4px 12px 4px 0;color:#6b6760;white-space:nowrap;vertical-align:top">${esc(k)}</td><td style="padding:4px 0;color:#1c1b18">${v}</td></tr>`;
  const card = (title: string, rows: string) =>
    `<div style="border:1px solid #e7e1d4;border-radius:10px;margin:0 0 14px;overflow:hidden">
       <div style="background:#f3eee4;padding:8px 14px;font-weight:700;font-size:14px;color:#1c1b18">${esc(title)}</div>
       <table style="width:100%;border-collapse:collapse;font-size:14px;padding:6px 14px"><tbody>${rows}</tbody></table>
     </div>`;

  const occRows = app.occupants
    .map(
      (o) =>
        `<tr style="border-top:1px solid #eee">
          <td style="padding:6px 8px">${esc(o.fullName)}</td>
          <td style="padding:6px 8px;white-space:nowrap">${esc(o.dob)}${o.age != null ? ` <span style="color:#8a847a">(${o.age})</span>` : ''}</td>
          <td style="padding:6px 8px">${esc(o.relationship)}</td>
          <td style="padding:6px 8px;text-align:center">${o.isAdult ? 'Yes' : 'No'}</td>
          <td style="padding:6px 8px;text-align:center">${o.isAdult ? yn(o.willCosign) : '—'}</td>
          <td style="padding:6px 8px;color:#6b6760">${o.willCosign === 'yes' ? `${esc(o.cosignEmail)}<br>${esc(o.cosignPhone)}${o.cosignIncome ? `<br>${money(o.cosignIncome)}/mo` : ''}` : ''}</td>
        </tr>`
    )
    .join('');

  const docHtml = docs.length
    ? docs
        .map(
          (d) =>
            `<li style="margin:4px 0"><strong>${esc(TYPE_LABELS[d.type] || d.type)}:</strong>
             <a href="${esc(d.url)}" style="color:#976c29">${esc(d.name)}</a></li>`
        )
        .join('')
    : '<li>(none)</li>';

  const html = `<!doctype html><html><body style="margin:0;background:#faf8f3;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#1c1b18">
  <div style="max-width:720px;margin:0 auto;padding:20px">
    <div style="background:#1c1b18;color:#fff;border-radius:12px;padding:16px 18px;margin-bottom:16px">
      <div style="font-size:13px;letter-spacing:.12em;text-transform:uppercase;color:#d9b66a">New rental application</div>
      <div style="font-size:20px;font-weight:700;margin-top:4px">${esc(app.unitLabel || app.unit)}</div>
      <div style="font-size:13px;color:#b6afa1;margin-top:4px">${esc(a.fullName)} · ${esc(submissionId)} · ${esc(app.consent.signedAt)}</div>
    </div>

    ${card('Unit & move-in', row('Unit', esc(app.unitLabel || app.unit)) + row('Move-in', esc(app.moveInDate)) + row('Lease term', esc(app.leaseTerm)) + row('Garage', yn(app.wantGarage)) + (app.hearAbout ? row('Heard via', esc(app.hearAbout)) : ''))}

    ${card('Applicant', row('Name', esc(a.fullName) + (a.preferredName ? ` (prefers ${esc(a.preferredName)})` : '')) + row('Date of birth', esc(a.dob)) + row('Email', `<a href="mailto:${esc(a.email)}" style="color:#976c29">${esc(a.email)}</a>`) + row('Phone', esc(a.phone) + (a.altPhone ? ` / ${esc(a.altPhone)}` : '')))}

    ${card('Residence history', row('Address', `${esc(r.street)}, ${esc(r.city)} ${esc(r.province)} ${esc(r.postal)}`) + row('Tenure', `${esc(r.ownRent)}${r.currentMoveIn ? `, since ${esc(r.currentMoveIn)}` : ''}`) + row('Reason for leaving', esc(r.reasonLeaving)) + (r.ownRent === 'rent' ? row('Landlord', `${esc(r.landlordName)} — ${esc(r.landlordPhone)}${r.landlordEmail ? ` / ${esc(r.landlordEmail)}` : ''}`) + row('Contact landlord?', esc(r.canContactLandlord)) + row('Current rent', money(r.currentRent)) : '') + row('Evicted for cause', yn(r.evicted) + (r.evictedExplain ? ` — ${esc(r.evictedExplain)}` : '')) + row('Broke a lease', yn(r.brokeLease) + (r.brokeLeaseExplain ? ` — ${esc(r.brokeLeaseExplain)}` : '')) + (r.previousResidences?.length ? row('Previous residences', r.previousResidences.map((p) => esc(`${p.street}, ${p.city} ${p.province} ${p.postal} (${p.from || '?'}–${p.to || '?'})`)).join('<br>')) : ''))}

    ${card('Employment & income', row('Status', esc(e.status)) + (e.employer ? row('Employer', esc(e.employer) + (e.jobTitle ? ` (${esc(e.jobTitle)})` : '')) : '') + (e.lengthWithEmployer ? row('Tenure', esc(e.lengthWithEmployer)) : '') + (e.employerPhone ? row('Employer phone', esc(e.employerPhone)) : '') + row('Gross monthly income', `<strong>${money(e.grossMonthlyIncome)}</strong>`) + (e.additionalIncome ? row('Additional household', money(e.additionalIncome)) : ''))}

    <div style="border:1px solid #e7e1d4;border-radius:10px;margin:0 0 14px;overflow:hidden">
      <div style="background:#f3eee4;padding:8px 14px;font-weight:700;font-size:14px">Occupants (${app.occupants.length})</div>
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <thead><tr style="text-align:left;color:#6b6760">
          <th style="padding:6px 8px">Name</th><th style="padding:6px 8px">DOB</th><th style="padding:6px 8px">Relationship</th><th style="padding:6px 8px">18+</th><th style="padding:6px 8px">Co-sign</th><th style="padding:6px 8px">Co-signer contact</th>
        </tr></thead>
        <tbody>${occRows}</tbody>
      </table>
    </div>

    ${card('Pets, vehicles & more', row('Pets', yn(b.hasPets) + (b.pets.length ? ` — ${b.pets.map((p) => esc(`${p.type}${p.breed ? ` (${p.breed})` : ''}${p.weight ? `, ${p.weight}lb` : ''}`)).join(', ')}` : '')) + row('Service/assistance animal', yn(b.serviceAnimal)) + row('Smoking', esc(b.smoking)) + row('Vehicles', b.vehicles.length ? b.vehicles.map((v) => esc(`${v.makeModel} ${v.plate}${v.parkingNeeded ? ' (needs parking)' : ''}`)).join('; ') : 'none') + row('Bankruptcy/proposal', esc(b.bankruptcy || '—')) + row('Guarantor', yn(b.hasGuarantor) + (b.hasGuarantor === 'yes' ? ` — ${esc(b.guarantor.name)}, ${esc(b.guarantor.phone)}, ${esc(b.guarantor.email)}` : '')) + row('Emergency contacts', b.emergencyContacts.map((e) => esc(`${e.name} (${e.relationship}) — ${e.phone}`)).join('<br>')))}

    <div style="border:1px solid #e7e1d4;border-radius:10px;margin:0 0 14px;padding:8px 14px">
      <div style="font-weight:700;font-size:14px;margin-bottom:6px">Documents <span style="font-weight:400;color:#8a847a;font-size:12px">(links expire — download promptly)</span></div>
      <ul style="margin:0;padding-left:18px;font-size:14px">${docHtml}</ul>
    </div>

    <div style="border:1px solid #e6d3a8;background:#f4e9d2;border-radius:10px;margin:0 0 14px;padding:12px 14px">
      <div style="font-weight:700;font-size:14px;color:#1c1b18;margin-bottom:4px">Next step — if you shortlist this applicant</div>
      <p style="margin:0 0 8px;font-size:13px;color:#4a463f">Government ID and a credit report are <strong>not</strong> collected up front. To request them, send the applicant their secure upload link (valid ${esc(String(docTtlDays))} days):</p>
      <a href="${esc(docRequestUrl)}" style="display:inline-block;background:#8a6220;color:#fff;text-decoration:none;font-weight:600;font-size:13px;padding:9px 14px;border-radius:6px">Copy the applicant's secure upload link</a>
      <p style="margin:8px 0 0;font-size:12px;color:#8a847a;word-break:break-all">${esc(docRequestUrl)}</p>
    </div>

    <div style="border:1px solid #e7e1d4;border-radius:10px;margin:0 0 14px;padding:8px 14px;font-size:13px;color:#4a463f">
      <strong>Consents confirmed:</strong> accuracy · no-fee acknowledgement · credit &amp; background check · privacy (PIPA/PIPEDA).<br>
      <strong>Electronic signature:</strong> ${esc(app.consent.signature)} &nbsp;·&nbsp; ${esc(app.consent.signedAt)}
    </div>

    <p style="font-size:12px;color:#8a847a">Review applicants using consistent criteria. Source of income, family status and related grounds are protected under the Alberta Human Rights Act. Securely destroy this data if the applicant is not selected, per your retention policy.</p>
  </div>
  </body></html>`;

  return { subject, html, text };
}

export function buildShortlistDocsEmail(name: string, submissionId: string, docs: DocLink[]) {
  const subject = `Shortlist documents received — ${name || submissionId}`;
  const text = [
    `SHORTLIST DOCUMENTS RECEIVED`,
    `Applicant: ${name || '(unknown)'}`,
    `Submission: ${submissionId}`,
    ``,
    `Documents (links expire — download promptly):`,
    ...(docs.length ? docs.map((d) => `  - ${TYPE_LABELS[d.type] || d.type}: ${d.name}\n    ${d.url}`) : ['  (none)']),
  ].join('\n');

  const docHtml = docs.length
    ? docs
        .map(
          (d) =>
            `<li style="margin:4px 0"><strong>${esc(TYPE_LABELS[d.type] || d.type)}:</strong> <a href="${esc(d.url)}" style="color:#976c29">${esc(d.name)}</a></li>`
        )
        .join('')
    : '<li>(none)</li>';

  const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;max-width:600px;margin:0 auto;color:#1c1b18">
    <div style="background:#1c1b18;color:#fff;border-radius:12px;padding:14px 16px;margin-bottom:14px">
      <div style="font-size:13px;letter-spacing:.12em;text-transform:uppercase;color:#d9b66a">Shortlist documents received</div>
      <div style="font-size:18px;font-weight:700;margin-top:4px">${esc(name || submissionId)}</div>
      <div style="font-size:13px;color:#b6afa1;margin-top:2px">${esc(submissionId)}</div>
    </div>
    <ul style="font-size:14px;padding-left:18px">${docHtml}</ul>
    <p style="font-size:12px;color:#8a847a">Links expire — download promptly. Store and destroy per your retention policy.</p>
  </div>`;

  return { subject, html, text };
}

export function buildContactEmail(c: Contact) {
  const subject = `Website enquiry (${c.reason}) — ${c.name}`;
  const text = `New contact enquiry\n\nName: ${c.name}\nEmail: ${c.email}\nPhone: ${c.phone || '—'}\nReason: ${c.reason}\n\n${c.message}`;
  const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;max-width:600px;margin:0 auto;color:#1c1b18">
    <h2 style="color:#1c1b18">New website enquiry</h2>
    <p><strong>Name:</strong> ${esc(c.name)}<br>
       <strong>Email:</strong> <a href="mailto:${esc(c.email)}">${esc(c.email)}</a><br>
       <strong>Phone:</strong> ${esc(c.phone || '—')}<br>
       <strong>Reason:</strong> ${esc(c.reason)}</p>
    <p style="white-space:pre-wrap;background:#f3eee4;padding:12px;border-radius:8px">${esc(c.message)}</p>
  </div>`;
  return { subject, html, text };
}

export async function sendOwnerEmail(
  env: {
    SEND_EMAIL?: { send: (m: unknown) => Promise<void> };
    FROM_EMAIL: string;
    OWNER_EMAIL: string;
    REPLY_TO?: string;
    DISABLE_EMAIL?: string;
  },
  payload: { subject: string; html: string; text: string }
): Promise<void> {
  const msg = createMimeMessage();
  msg.setSender({ name: 'HavenNest Website', addr: env.FROM_EMAIL });
  msg.setRecipient(env.OWNER_EMAIL);
  if (env.REPLY_TO) {
    // mimetext validates address headers; pass an address object and never let
    // a malformed value crash the request.
    try {
      msg.setHeader('Reply-To', { addr: env.REPLY_TO } as never);
    } catch {
      try {
        msg.setHeader('Reply-To', env.REPLY_TO);
      } catch {
        /* ignore — Reply-To is best-effort */
      }
    }
  }
  msg.setSubject(payload.subject);
  msg.addMessage({ contentType: 'text/plain', data: payload.text });
  msg.addMessage({ contentType: 'text/html', data: payload.html });

  if (!env.SEND_EMAIL || env.DISABLE_EMAIL === '1') {
    console.log('[dev] email sending disabled — not sent. Subject:', payload.subject);
    return;
  }
  const message = new EmailMessage(env.FROM_EMAIL, env.OWNER_EMAIL, msg.asRaw());
  await env.SEND_EMAIL.send(message);
}
