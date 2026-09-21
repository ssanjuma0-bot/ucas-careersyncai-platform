const net = require('net');
const tls = require('tls');

function isEmailConfigured() {
  return !!(process.env.SMTP_HOST && process.env.SMTP_PORT && process.env.SMTP_USER && process.env.SMTP_PASSWORD && process.env.SMTP_FROM);
}

const TEMPLATES = {
  registrationComplete: (name) => ({ subject: 'UCAS CareerSync AI – Registration Completed', text: `Hi ${name},\n\nYour UCAS CareerSync AI student account has been created successfully. Complete your profile to improve your placement readiness score.\n\n— UCAS CareerSync AI` }),
  applicationSubmitted: (name, role, company) => ({ subject: 'UCAS CareerSync AI – Application Submitted', text: `Hi ${name},\n\nYour application for ${role} at ${company} has been submitted successfully. You can track its status from My Applications.\n\n— UCAS CareerSync AI` }),
  applicationStatusChanged: (name, role, company, status) => ({ subject: 'UCAS CareerSync AI – Application Update', text: `Hi ${name},\n\nYour application for ${role} at ${company} is now: ${status}.\n\n— UCAS CareerSync AI` }),
  interviewScheduled: (name, role, company, dateStr) => ({ subject: 'UCAS CareerSync AI – Interview Scheduled', text: `Hi ${name},\n\nAn interview has been scheduled for your application to ${role} at ${company} on ${dateStr}. Check your dashboard for full details.\n\n— UCAS CareerSync AI` }),
  recruiterApproved: (name, company) => ({ subject: 'UCAS CareerSync AI – Recruiter Account Approved', text: `Hi ${name},\n\nYour recruiter account for ${company} has been approved. You can now log in and post jobs.\n\n— UCAS CareerSync AI` })
};

function sendMail({ to, subject, text }) {
  return new Promise((resolve, reject) => {
    if (!isEmailConfigured()) { resolve({ sent: false, reason: 'Email service is not configured (missing SMTP_* environment variables).' }); return; }
    const host = process.env.SMTP_HOST, port = Number(process.env.SMTP_PORT), user = process.env.SMTP_USER, pass = process.env.SMTP_PASSWORD, from = process.env.SMTP_FROM;
    let socket = net.createConnection({ host, port });
    let step = 'connect', buffer = '';
    const finish = (err, result) => { try { socket.end(); } catch (e) {} if (err) reject(err); else resolve(result); };
    function send(line) { socket.write(line + '\r\n'); }
    function upgradeTls() {
      const plainSocket = socket;
      socket = tls.connect({ socket: plainSocket, host, servername: host }, () => { step = 'ehlo2'; send(`EHLO careersync-ai`); });
      attachDataHandler();
    }
    function attachDataHandler() {
      socket.on('data', (chunk) => {
        buffer += chunk.toString();
        if (!buffer.endsWith('\r\n')) return;
        const lines = buffer.trim().split('\r\n');
        const code = lines[lines.length - 1].slice(0, 3);
        buffer = '';
        if (step === 'connect' && code === '220') { step = 'ehlo'; send(`EHLO careersync-ai`); return; }
        if (step === 'ehlo' && code === '250') { step = 'starttls'; send('STARTTLS'); return; }
        if (step === 'starttls' && code === '220') { upgradeTls(); return; }
        if (step === 'ehlo2' && code === '250') { step = 'auth'; send('AUTH LOGIN'); return; }
        if (step === 'auth' && code === '334') { step = 'user'; send(Buffer.from(user).toString('base64')); return; }
        if (step === 'user' && code === '334') { step = 'pass'; send(Buffer.from(pass).toString('base64')); return; }
        if (step === 'pass' && code === '235') { step = 'mailfrom'; send(`MAIL FROM:<${from}>`); return; }
        if (step === 'mailfrom' && code === '250') { step = 'rcptto'; send(`RCPT TO:<${to}>`); return; }
        if (step === 'rcptto' && code === '250') { step = 'data'; send('DATA'); return; }
        if (step === 'data' && code === '354') { step = 'sending'; send(`From: ${from}\r\nTo: ${to}\r\nSubject: ${subject}\r\n\r\n${text}\r\n.`); return; }
        if (step === 'sending' && code === '250') { step = 'quit'; send('QUIT'); finish(null, { sent: true }); return; }
        if (!code.startsWith('2') && !code.startsWith('3')) finish(new Error(`SMTP error at step "${step}": ${lines[lines.length - 1]}`));
      });
    }
    attachDataHandler();
    socket.on('error', (e) => finish(e));
    socket.setTimeout(15000, () => finish(new Error('SMTP connection timed out')));
  });
}
module.exports = { isEmailConfigured, TEMPLATES, sendMail };
