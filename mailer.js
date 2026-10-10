// Transactional email through Brevo: https://developers.brevo.com/docs/send-a-transactional-email
// Needs BREVO_API_KEY and MAIL_FROM (a sender address you verified in Brevo).
// Everything here fails softly: if email is not set up, or Brevo is down, the app keeps working and skips the email.
const { BREVO_API_KEY, MAIL_FROM, MAIL_FROM_NAME = 'Ido-Osun Market' } = process.env;
const API = process.env.BREVO_API_URL || 'https://api.brevo.com/v3/smtp/email';
const enabled = !!(BREVO_API_KEY && MAIL_FROM);

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Turns Brevo's error into something the owner can act on.
function hint(status, msg) {
  const m = String(msg || '');
  if (/unrecognised IP|authorised_ips|authorized.?ip/i.test(m))
    return 'Brevo blocked this server\'s IP address. In Brevo go to Security > Authorised IPs and deactivate IP blocking, then try again. (' + m.slice(0, 120) + ')';
  if (status === 401) return 'Brevo rejected the API key. Check BREVO_API_KEY on your host: it must be an API key (starts with xkeysib-), not an SMTP key. (' + m + ')';
  if (/sender/i.test(m)) return 'Brevo does not accept the sender address ' + MAIL_FROM + '. Add it under Senders in Brevo, open the verification email Brevo sends to it, and make MAIL_FROM match exactly. (' + m + ')';
  return (m || 'HTTP ' + status) + ' (HTTP ' + status + ')';
}

async function send({ to, subject, text, html }) {
  if (!enabled) return { ok: false, error: 'Email is not set up' };
  if (!to || /@demo\.idoosun\.local$/i.test(to)) return { ok: false, error: 'No recipient' };   // never email demo accounts
  try {
    const r = await fetch(API, {
      method: 'POST',
      headers: { 'api-key': BREVO_API_KEY, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ sender: { name: MAIL_FROM_NAME, email: MAIL_FROM }, to: [{ email: to }], subject, textContent: text, htmlContent: html }),
      signal: AbortSignal.timeout(8000),
    });
    if (r.ok) return { ok: true };
    let msg = ''; try { msg = (await r.json()).message || ''; } catch {}
    console.error('email failed', r.status, msg);
    return { ok: false, error: hint(r.status, msg) };
  } catch (e) { console.error('email failed', e.message); return { ok: false, error: e.message }; }
}

/* ---------- message templates ---------- */
const p = t => `<p style="margin:0 0 12px">${esc(t)}</p>`;
const shell = (title, body, cta) => `<div style="font-family:system-ui,Arial,sans-serif;background:#f3f6f1;padding:24px"><div style="max-width:520px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden"><div style="background:#2f5d50;color:#fff;padding:16px 24px;font-weight:700;font-size:18px">🌿 Ido-Osun Market</div><div style="padding:24px;color:#1d2b24;line-height:1.5"><h2 style="margin:0 0 12px;font-size:20px">${esc(title)}</h2>${body}${cta ? `<p style="margin:24px 0 0"><a href="${esc(cta[1])}" style="background:#2f5d50;color:#fff;text-decoration:none;padding:12px 22px;border-radius:999px;display:inline-block;font-weight:600">${esc(cta[0])}</a></p>` : ''}</div><div style="padding:14px 24px;color:#66766d;font-size:12px">You are receiving this because of activity on Ido-Osun Market.</div></div></div>`;
const mk = (subject, lines, cta) => ({
  subject,
  text: lines.join('\n\n') + (cta && cta[1] ? `\n\n${cta[0]}: ${cta[1]}` : ''),
  html: shell(subject, lines.map(p).join(''), cta && cta[1] ? cta : null),
});

const tpl = {
  order: (text, url) => ({
    subject: 'New order on Ido-Osun Market',
    text: `You have a new order:\n\n${text}\n\nConfirm availability, price and delivery with the buyer on WhatsApp.` + (url ? `\n\nOpen your dashboard: ${url}` : ''),
    html: shell('You have a new order', `<pre style="white-space:pre-wrap;font-family:inherit;background:#f3f6f1;padding:12px;border-radius:10px;margin:0 0 12px">${esc(text)}</pre>${p('Confirm availability, price and delivery with the buyer on WhatsApp.')}`, url ? ['Open dashboard', url] : null),
  }),
  welcome: (first, url) => mk('Welcome to Ido-Osun Market', [
    `Hi ${first}, your account has been created. Thank you for joining Ido-Osun Market.`,
    'You can now browse local stores, add products to your cart and order straight on WhatsApp. If you did not create this account, please ignore this email or contact us.'], ['Start shopping', url]),
  welcomeVendor: (shop, url) => mk('Welcome to Ido-Osun Market', [
    `Thank you for registering ${shop}.`,
    'Your store is waiting for approval and will appear publicly once approved. Meanwhile, you can add your products, photos and prices from your dashboard.'], ['Open dashboard', url]),
  adminNewVendor: (shop, owner, email, wa, url) => mk('New vendor application: ' + shop, [
    `${owner} (${email}) registered the shop "${shop}". WhatsApp number: ${wa}.`,
    'Review it in the admin screen and approve or reject it.'], ['Open admin screen', url]),
  storeStatus: (shop, status, url) => ({
    approved: () => mk('Your store is live', [`Good news: ${shop} has been approved and is now visible to buyers on Ido-Osun Market.`, 'Orders will reach you on WhatsApp, and you will see them in your dashboard.'], ['Open dashboard', url]),
    rejected: () => mk('Your store was not approved', [`We could not approve ${shop} at this time.`, 'Please contact us if you would like to know why or to apply again.']),
    suspended: () => mk('Your store has been suspended', [`${shop} has been suspended and is not visible to buyers.`, 'Please contact us to find out why and how to have it restored.']),
  }[status] || (() => mk('Your store was updated', [`The status of ${shop} is now ${status}.`])))(),
  reset: url => mk('Reset your password', ['We received a request to reset your Ido-Osun Market password.', 'This link works for 1 hour. If you did not ask for it, you can ignore this email and your password will stay the same.'], ['Choose a new password', url]),
  passwordChanged: () => mk('Your password was changed', ['The password for your Ido-Osun Market account was just changed.', 'If this was not you, please contact us right away.']),
  test: () => mk('Test email from Ido-Osun Market', ['Brevo email is working. Order alerts, store approvals and password resets will be sent from this address.']),
};

module.exports = { enabled, send, tpl, from: MAIL_FROM || '' };
