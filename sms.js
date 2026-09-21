function isSmsConfigured() {
  return !!(process.env.SMS_ACCOUNT_SID && process.env.SMS_AUTH_TOKEN && process.env.SMS_FROM);
}
async function sendSms({ to, body }) {
  if (!isSmsConfigured()) return { sent: false, reason: 'SMS provider is not configured (missing SMS_ACCOUNT_SID / SMS_AUTH_TOKEN / SMS_FROM).' };
  const sid = process.env.SMS_ACCOUNT_SID, token = process.env.SMS_AUTH_TOKEN, from = process.env.SMS_FROM;
  const url = `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`;
  const params = new URLSearchParams({ To: to, From: from, Body: body });
  const auth = Buffer.from(`${sid}:${token}`).toString('base64');
  try {
    const resp = await fetch(url, { method: 'POST', headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: params.toString() });
    if (!resp.ok) { const errText = await resp.text().catch(() => ''); return { sent: false, reason: `SMS provider returned status ${resp.status}: ${errText.slice(0, 200)}` }; }
    const data = await resp.json();
    return { sent: true, sid: data.sid };
  } catch (e) { return { sent: false, reason: 'SMS request failed: ' + (e.message || 'network error') }; }
}
module.exports = { isSmsConfigured, sendSms };
