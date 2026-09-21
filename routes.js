const { db } = require('../db');
const { hashPassword, verifyPassword, signToken } = require('./auth');
const { uid, isValidEmail } = require('./util');
const { jobMatchScore } = require('./careerLogic');
const { callAiProvider } = require('./ai');
const { isEmailConfigured, TEMPLATES, sendMail } = require('./email');

function row(stmt, ...params) { return db.prepare(stmt).get(...params); }
function all(stmt, ...params) { return db.prepare(stmt).all(...params); }
function run(stmt, ...params) { return db.prepare(stmt).run(...params); }

function studentOut(s) {
  if (!s) return null;
  return {
    id: s.id, userId: s.user_id, fullName: s.full_name, studentIdNo: s.student_id_no, email: s.email,
    mobile: s.mobile, dob: s.dob, gender: s.gender, department: s.department, course: s.course, year: s.year,
    cgpa: s.cgpa, location: s.location, careerGoal: s.career_goal, preferredLocation: s.preferred_location,
    skills: JSON.parse(s.skills_json || '[]'), projects: JSON.parse(s.projects_json || '[]'),
    linkedin: s.linkedin, github: s.github, photo: s.photo
  };
}
function jobOut(j) {
  return {
    id: j.id, recruiterId: j.recruiter_id, role: j.role, company: j.company, location: j.location,
    workMode: j.work_mode, salaryMin: j.salary_min, salaryMax: j.salary_max, skills: JSON.parse(j.skills_json || '[]'),
    experience: j.experience, minCgpa: j.min_cgpa, description: j.description, requirements: j.requirements,
    deadline: j.deadline, vacancies: j.vacancies, status: j.status, postedDate: j.created_at
  };
}
function appOut(a) {
  return { id: a.id, studentId: a.student_id, jobId: a.job_id, recruiterId: a.recruiter_id, status: a.status, matchScore: a.match_score, applicationData: JSON.parse(a.application_data_json || '{}'), appliedAt: a.applied_at, updatedAt: a.updated_at };
}
function recruiterOut(r) {
  return { id: r.id, userId: r.user_id, companyName: r.company_name, recruiterName: r.recruiter_name, email: r.email, phone: r.phone, designation: r.designation, website: r.website, industry: r.industry, description: r.description, location: r.location, status: r.status };
}
function addAudit(actor, action, meta) { run('INSERT INTO audit_logs (id, actor, action, meta_json) VALUES (?,?,?,?)', uid('audit'), actor || 'system', action, JSON.stringify(meta || {})); }
function notify(userId, title, body, type) { run('INSERT INTO notifications (id, user_id, title, body, type) VALUES (?,?,?,?,?)', uid('notif'), userId, title, body, type || 'info'); }

const routes = [];
function route(method, pattern, handler) {
  const keys = [];
  const rx = new RegExp('^' + pattern.replace(/:[^/]+/g, (m) => { keys.push(m.slice(1)); return '([^/]+)'; }) + '$');
  routes.push({ method, rx, keys, handler });
}
function matchRoute(method, pathname) {
  for (const r of routes) {
    if (r.method !== method) continue;
    const m = pathname.match(r.rx);
    if (m) { const params = {}; r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1]))); return { handler: r.handler, params }; }
  }
  return null;
}
function requireAuth(user, res) { if (!user) { res.sendJson(401, { error: 'Authentication required.' }); return false; } return true; }
function requireRole(user, role, res) {
  if (!user) { res.sendJson(401, { error: 'Authentication required.' }); return false; }
  if (user.role !== role) { res.sendJson(403, { error: `This action requires the ${role} role.` }); return false; }
  return true;
}

/* ---------------------------- AUTH ---------------------------- */

route('POST', '/api/auth/register/student', async (req, res) => {
  const b = req.body;
  const errors = {};
  if (!b.fullName || b.fullName.trim().length < 2) errors.fullName = 'Full name is required.';
  if (!b.studentIdNo) errors.studentIdNo = 'Student ID is required.';
  if (!isValidEmail(b.email)) errors.email = 'Enter a valid email address.';
  if (!b.password || b.password.length < 6) errors.password = 'Password must be at least 6 characters.';
  if (Object.keys(errors).length) return res.sendJson(400, { errors });
  if (row('SELECT id FROM users WHERE email = ?', b.email.toLowerCase())) return res.sendJson(409, { errors: { email: 'An account with this email already exists.' } });
  if (row('SELECT id FROM students WHERE student_id_no = ?', b.studentIdNo)) return res.sendJson(409, { errors: { studentIdNo: 'This Student ID is already registered.' } });

  const { hash, salt } = hashPassword(b.password);
  const userId = uid('user'), studentId = uid('stu');
  run('INSERT INTO users (id, role, email, password_hash, password_salt) VALUES (?,?,?,?,?)', userId, 'student', b.email.toLowerCase(), hash, salt);
  run(`INSERT INTO students (id, user_id, full_name, student_id_no, email, mobile, dob, gender, department, course, year, cgpa, location, career_goal, preferred_location, skills_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    studentId, userId, b.fullName.trim(), b.studentIdNo, b.email.toLowerCase(), b.mobile || '', b.dob || '', b.gender || '', 'B.Sc Computer Science with Data Analytics', b.course || '', b.year || '', b.cgpa || '', b.location || '', b.careerGoal || '', b.location || '', JSON.stringify(b.skills || []));
  notify(userId, 'Welcome to UCAS CareerSync AI', 'Your student account was created successfully.', 'success');
  addAudit(b.email, 'student_registered', {});
  const emailResult = await sendMail({ to: b.email, ...TEMPLATES.registrationComplete(b.fullName) });
  const token = signToken({ sub: userId, role: 'student' });
  res.sendJson(201, { token, student: studentOut(row('SELECT * FROM students WHERE id = ?', studentId)), emailSent: emailResult.sent, emailNote: emailResult.reason || null });
});

route('POST', '/api/auth/register/recruiter', async (req, res) => {
  const b = req.body;
  const errors = {};
  if (!b.companyName) errors.companyName = 'Company name is required.';
  if (!b.recruiterName) errors.recruiterName = 'Recruiter name is required.';
  if (!isValidEmail(b.email)) errors.email = 'Enter a valid official email address.';
  if (!b.password || b.password.length < 6) errors.password = 'Password must be at least 6 characters.';
  if (Object.keys(errors).length) return res.sendJson(400, { errors });
  if (row('SELECT id FROM users WHERE email = ?', b.email.toLowerCase())) return res.sendJson(409, { errors: { email: 'An account with this email already exists.' } });
  const { hash, salt } = hashPassword(b.password);
  const userId = uid('user'), recId = uid('rec');
  run('INSERT INTO users (id, role, email, password_hash, password_salt) VALUES (?,?,?,?,?)', userId, 'recruiter', b.email.toLowerCase(), hash, salt);
  run(`INSERT INTO recruiters (id, user_id, company_name, recruiter_name, email, phone, designation, website, industry, description, location, status) VALUES (?,?,?,?,?,?,?,?,?,?,?,'pending')`,
    recId, userId, b.companyName, b.recruiterName, b.email.toLowerCase(), b.phone || '', b.designation || '', b.website || '', b.industry || '', b.description || '', b.location || '');
  addAudit(b.email, 'recruiter_registered', {});
  res.sendJson(201, { recruiter: recruiterOut(row('SELECT * FROM recruiters WHERE id = ?', recId)), message: 'Registered. Your account is pending admin approval.' });
});

route('POST', '/api/auth/login', async (req, res) => {
  const { email, password, role } = req.body;
  if (!isValidEmail(email) || !password || !['student', 'recruiter', 'admin'].includes(role)) return res.sendJson(400, { error: 'Email, password and a valid role are required.' });
  if (role === 'admin') {
    const admin = row('SELECT * FROM admins WHERE email = ?', email.toLowerCase());
    if (!admin || !verifyPassword(password, admin.password_hash, admin.password_salt)) return res.sendJson(401, { error: 'Invalid email or password.' });
    if (admin.status !== 'active') return res.sendJson(403, { error: 'This administrator account is inactive.' });
    const token = signToken({ sub: admin.id, role: 'admin' });
    return res.sendJson(200, { token, admin: { id: admin.id, name: admin.name, email: admin.email } });
  }
  const user = row('SELECT * FROM users WHERE email = ? AND role = ?', email.toLowerCase(), role);
  if (!user || !verifyPassword(password, user.password_hash, user.password_salt)) return res.sendJson(401, { error: 'Invalid email or password.' });
  if (role === 'student') {
    const student = row('SELECT * FROM students WHERE user_id = ?', user.id);
    return res.sendJson(200, { token: signToken({ sub: user.id, role: 'student' }), student: studentOut(student) });
  }
  if (role === 'recruiter') {
    const recruiter = row('SELECT * FROM recruiters WHERE user_id = ?', user.id);
    if (recruiter.status === 'pending') return res.sendJson(403, { error: 'Your recruiter account is pending admin approval.', status: 'pending' });
    if (recruiter.status !== 'approved') return res.sendJson(403, { error: 'Your recruiter account is not active.', status: recruiter.status });
    return res.sendJson(200, { token: signToken({ sub: user.id, role: 'recruiter' }), recruiter: recruiterOut(recruiter) });
  }
});

/* ---------------------------- STUDENTS ---------------------------- */

route('GET', '/api/students/me', async (req, res) => {
  if (!requireRole(req.user, 'student', res)) return;
  res.sendJson(200, { student: studentOut(row('SELECT * FROM students WHERE user_id = ?', req.user.sub)) });
});

route('PUT', '/api/students/me', async (req, res) => {
  if (!requireRole(req.user, 'student', res)) return;
  const s = row('SELECT * FROM students WHERE user_id = ?', req.user.sub);
  if (!s) return res.sendJson(404, { error: 'Student profile not found.' });
  const b = req.body;
  run(`UPDATE students SET full_name=?, mobile=?, cgpa=?, location=?, career_goal=?, preferred_location=?, skills_json=?, projects_json=?, linkedin=?, github=?, updated_at=datetime('now') WHERE id=?`,
    b.fullName ?? s.full_name, b.mobile ?? s.mobile, b.cgpa ?? s.cgpa, b.location ?? s.location, b.careerGoal ?? s.career_goal,
    b.preferredLocation ?? s.preferred_location, JSON.stringify(b.skills ?? JSON.parse(s.skills_json)), JSON.stringify(b.projects ?? JSON.parse(s.projects_json)),
    b.linkedin ?? s.linkedin, b.github ?? s.github, s.id);
  addAudit(req.user.sub, 'profile_updated', {});
  res.sendJson(200, { student: studentOut(row('SELECT * FROM students WHERE id = ?', s.id)) });
});

route('POST', '/api/students/me/photo', async (req, res) => {
  if (!requireRole(req.user, 'student', res)) return;
  const { photoDataUrl } = req.body;
  if (!photoDataUrl || !photoDataUrl.startsWith('data:image/')) return res.sendJson(400, { error: 'A valid image data URL is required.' });
  if (photoDataUrl.length > 4 * 1024 * 1024) return res.sendJson(400, { error: 'Image too large (max ~3MB).' });
  run(`UPDATE students SET photo=?, updated_at=datetime('now') WHERE user_id=?`, photoDataUrl, req.user.sub);
  res.sendJson(200, { ok: true });
});

/* ---------------------------- JOBS ---------------------------- */

route('GET', '/api/jobs', async (req, res) => { res.sendJson(200, { jobs: all("SELECT * FROM jobs WHERE status='open' ORDER BY created_at DESC").map(jobOut) }); });

route('GET', '/api/jobs/:id', async (req, res) => {
  const job = row('SELECT * FROM jobs WHERE id = ?', req.params.id);
  if (!job) return res.sendJson(404, { error: 'Job not found.' });
  res.sendJson(200, { job: jobOut(job) });
});

route('POST', '/api/jobs', async (req, res) => {
  if (!requireRole(req.user, 'recruiter', res)) return;
  const rec = row('SELECT * FROM recruiters WHERE user_id = ?', req.user.sub);
  const b = req.body;
  if (!b.role) return res.sendJson(400, { error: 'Job role/title is required.' });
  const id = uid('job');
  run(`INSERT INTO jobs (id, recruiter_id, role, company, location, work_mode, salary_min, salary_max, skills_json, experience, min_cgpa, description, requirements, deadline, vacancies) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    id, rec.id, b.role, rec.company_name, b.location || '', b.workMode || 'On-site', b.salaryMin || 0, b.salaryMax || 0, JSON.stringify(b.skills || []), b.experience || 'Fresher', b.minCgpa || 0, b.description || '', b.requirements || '', b.deadline || '', b.vacancies || 1);
  addAudit(req.user.sub, 'job_created', { id });
  res.sendJson(201, { job: jobOut(row('SELECT * FROM jobs WHERE id = ?', id)) });
});

route('PUT', '/api/jobs/:id', async (req, res) => {
  if (!requireRole(req.user, 'recruiter', res)) return;
  const rec = row('SELECT * FROM recruiters WHERE user_id = ?', req.user.sub);
  const job = row('SELECT * FROM jobs WHERE id = ? AND recruiter_id = ?', req.params.id, rec.id);
  if (!job) return res.sendJson(404, { error: 'Job not found.' });
  const b = req.body;
  run(`UPDATE jobs SET role=?, location=?, work_mode=?, salary_min=?, salary_max=?, skills_json=?, min_cgpa=?, deadline=?, vacancies=?, description=?, requirements=? WHERE id=?`,
    b.role ?? job.role, b.location ?? job.location, b.workMode ?? job.work_mode, b.salaryMin ?? job.salary_min, b.salaryMax ?? job.salary_max,
    JSON.stringify(b.skills ?? JSON.parse(job.skills_json)), b.minCgpa ?? job.min_cgpa, b.deadline ?? job.deadline, b.vacancies ?? job.vacancies, b.description ?? job.description, b.requirements ?? job.requirements, job.id);
  addAudit(req.user.sub, 'job_updated', { id: job.id });
  res.sendJson(200, { job: jobOut(row('SELECT * FROM jobs WHERE id = ?', job.id)) });
});

route('PATCH', '/api/jobs/:id/status', async (req, res) => {
  if (!requireRole(req.user, 'recruiter', res)) return;
  const rec = row('SELECT * FROM recruiters WHERE user_id = ?', req.user.sub);
  const job = row('SELECT * FROM jobs WHERE id = ? AND recruiter_id = ?', req.params.id, rec.id);
  if (!job) return res.sendJson(404, { error: 'Job not found.' });
  run('UPDATE jobs SET status=? WHERE id=?', req.body.status === 'closed' ? 'closed' : 'open', job.id);
  res.sendJson(200, { job: jobOut(row('SELECT * FROM jobs WHERE id = ?', job.id)) });
});

route('DELETE', '/api/jobs/:id', async (req, res) => {
  if (!requireRole(req.user, 'recruiter', res)) return;
  const rec = row('SELECT * FROM recruiters WHERE user_id = ?', req.user.sub);
  const job = row('SELECT * FROM jobs WHERE id = ? AND recruiter_id = ?', req.params.id, rec.id);
  if (!job) return res.sendJson(404, { error: 'Job not found.' });
  run('DELETE FROM jobs WHERE id = ?', job.id);
  addAudit(req.user.sub, 'job_deleted', { id: job.id });
  res.sendJson(200, { ok: true });
});

route('GET', '/api/recruiters/me', async (req, res) => {
  if (!requireRole(req.user, 'recruiter', res)) return;
  res.sendJson(200, { recruiter: recruiterOut(row('SELECT * FROM recruiters WHERE user_id = ?', req.user.sub)) });
});
route('PUT', '/api/recruiters/me', async (req, res) => {
  if (!requireRole(req.user, 'recruiter', res)) return;
  const rec = row('SELECT * FROM recruiters WHERE user_id = ?', req.user.sub);
  const b = req.body;
  run('UPDATE recruiters SET company_name=?, description=?, website=? WHERE id=?', b.companyName ?? rec.company_name, b.description ?? rec.description, b.website ?? rec.website, rec.id);
  res.sendJson(200, { recruiter: recruiterOut(row('SELECT * FROM recruiters WHERE id = ?', rec.id)) });
});
route('GET', '/api/recruiters/me/jobs', async (req, res) => {
  if (!requireRole(req.user, 'recruiter', res)) return;
  const rec = row('SELECT * FROM recruiters WHERE user_id = ?', req.user.sub);
  res.sendJson(200, { jobs: all('SELECT * FROM jobs WHERE recruiter_id = ? ORDER BY created_at DESC', rec.id).map(jobOut) });
});
route('GET', '/api/recruiters/me/applications', async (req, res) => {
  if (!requireRole(req.user, 'recruiter', res)) return;
  const rec = row('SELECT * FROM recruiters WHERE user_id = ?', req.user.sub);
  res.sendJson(200, { applications: all('SELECT * FROM applications WHERE recruiter_id = ? ORDER BY applied_at DESC', rec.id).map(appOut) });
});

/* ---------------------------- APPLICATIONS ---------------------------- */

route('POST', '/api/applications', async (req, res) => {
  if (!requireRole(req.user, 'student', res)) return;
  const student = row('SELECT * FROM students WHERE user_id = ?', req.user.sub);
  const job = row('SELECT * FROM jobs WHERE id = ?', req.body.jobId);
  if (!job) return res.sendJson(404, { error: 'Job not found.' });
  if (row('SELECT id FROM applications WHERE student_id=? AND job_id=?', student.id, job.id)) return res.sendJson(409, { error: 'You have already applied for this position.' });
  const score = jobMatchScore(student, job);
  const id = uid('app');
  run('INSERT INTO applications (id, student_id, job_id, recruiter_id, status, match_score, application_data_json) VALUES (?,?,?,?,?,?,?)', id, student.id, job.id, job.recruiter_id, 'Applied', score, JSON.stringify(req.body.applicationData || {}));
  notify(req.user.sub, 'Application Submitted', `You applied to ${job.role} at ${job.company}.`, 'success');
  addAudit(req.user.sub, 'job_applied', { jobId: job.id });
  const emailResult = await sendMail({ to: student.email, ...TEMPLATES.applicationSubmitted(student.full_name, job.role, job.company) });
  res.sendJson(201, { application: appOut(row('SELECT * FROM applications WHERE id = ?', id)), emailSent: emailResult.sent });
});

route('GET', '/api/applications/mine', async (req, res) => {
  if (!requireRole(req.user, 'student', res)) return;
  const student = row('SELECT * FROM students WHERE user_id = ?', req.user.sub);
  res.sendJson(200, { applications: all('SELECT * FROM applications WHERE student_id = ? ORDER BY applied_at DESC', student.id).map(appOut) });
});

route('GET', '/api/jobs/:id/applicants', async (req, res) => {
  if (!requireRole(req.user, 'recruiter', res)) return;
  const rec = row('SELECT * FROM recruiters WHERE user_id = ?', req.user.sub);
  const job = row('SELECT * FROM jobs WHERE id = ? AND recruiter_id = ?', req.params.id, rec.id);
  if (!job) return res.sendJson(404, { error: 'Job not found or not owned by this recruiter.' });
  const apps = all('SELECT * FROM applications WHERE job_id = ? ORDER BY applied_at DESC', job.id);
  res.sendJson(200, { applicants: apps.map(a => ({ application: appOut(a), student: studentOut(row('SELECT * FROM students WHERE id = ?', a.student_id)) })) });
});

route('PATCH', '/api/applications/:id/status', async (req, res) => {
  if (!requireRole(req.user, 'recruiter', res)) return;
  const rec = row('SELECT * FROM recruiters WHERE user_id = ?', req.user.sub);
  const app = row('SELECT * FROM applications WHERE id = ? AND recruiter_id = ?', req.params.id, rec.id);
  if (!app) return res.sendJson(404, { error: 'Application not found.' });
  const status = req.body.status;
  if (!status) return res.sendJson(400, { error: 'status is required.' });
  run(`UPDATE applications SET status=?, updated_at=datetime('now') WHERE id=?`, status, app.id);
  const student = row('SELECT * FROM students WHERE id = ?', app.student_id);
  const job = row('SELECT * FROM jobs WHERE id = ?', app.job_id);
  notify(student.user_id, 'Application Update', `Your application for ${job.role} at ${job.company} is now: ${status}.`, status === 'Selected' ? 'success' : status === 'Rejected' ? 'error' : 'info');
  addAudit(req.user.sub, 'application_status_updated', { id: app.id, status });
  const emailResult = await sendMail({ to: student.email, ...TEMPLATES.applicationStatusChanged(student.full_name, job.role, job.company, status) });
  res.sendJson(200, { application: appOut(row('SELECT * FROM applications WHERE id = ?', app.id)), emailSent: emailResult.sent });
});

/* ---------------------------- INTERVIEWS ---------------------------- */

route('POST', '/api/interviews', async (req, res) => {
  if (!requireRole(req.user, 'recruiter', res)) return;
  const rec = row('SELECT * FROM recruiters WHERE user_id = ?', req.user.sub);
  const app = row('SELECT * FROM applications WHERE id = ? AND recruiter_id = ?', req.body.applicationId, rec.id);
  if (!app) return res.sendJson(404, { error: 'Application not found.' });
  const id = uid('iv'); const b = req.body;
  run('INSERT INTO interviews (id, application_id, student_id, job_id, date, type, mode, link, notes) VALUES (?,?,?,?,?,?,?,?,?)', id, app.id, app.student_id, app.job_id, b.date, b.type || 'Technical', b.mode || 'Online', b.link || '', b.notes || '');
  run(`UPDATE applications SET status='Interview Scheduled', updated_at=datetime('now') WHERE id=?`, app.id);
  const student = row('SELECT * FROM students WHERE id = ?', app.student_id);
  const job = row('SELECT * FROM jobs WHERE id = ?', app.job_id);
  notify(student.user_id, 'Interview Scheduled', `Interview for ${job.role} scheduled on ${b.date}.`, 'info');
  addAudit(req.user.sub, 'interview_scheduled', { id });
  const emailResult = await sendMail({ to: student.email, ...TEMPLATES.interviewScheduled(student.full_name, job.role, job.company, b.date) });
  res.sendJson(201, { interview: row('SELECT * FROM interviews WHERE id = ?', id), emailSent: emailResult.sent });
});

route('GET', '/api/interviews/mine', async (req, res) => {
  if (!requireRole(req.user, 'student', res)) return;
  const student = row('SELECT * FROM students WHERE user_id = ?', req.user.sub);
  res.sendJson(200, { interviews: all('SELECT * FROM interviews WHERE student_id = ? ORDER BY date ASC', student.id) });
});

/* ---------------------------- CERTIFICATES ---------------------------- */

route('GET', '/api/certificates/mine', async (req, res) => {
  if (!requireRole(req.user, 'student', res)) return;
  const student = row('SELECT * FROM students WHERE user_id = ?', req.user.sub);
  res.sendJson(200, { certificates: all('SELECT * FROM certificates WHERE student_id = ? ORDER BY created_at DESC', student.id) });
});
route('POST', '/api/certificates', async (req, res) => {
  if (!requireRole(req.user, 'student', res)) return;
  const student = row('SELECT * FROM students WHERE user_id = ?', req.user.sub);
  const b = req.body;
  if (!b.name) return res.sendJson(400, { error: 'Certificate name is required.' });
  const id = uid('cert');
  run('INSERT INTO certificates (id, student_id, name, issuer, issue_date, credential_id, url) VALUES (?,?,?,?,?,?,?)', id, student.id, b.name, b.issuer || '', b.issueDate || '', b.credentialId || '', b.url || '');
  res.sendJson(201, { certificate: row('SELECT * FROM certificates WHERE id = ?', id) });
});
route('PUT', '/api/certificates/:id', async (req, res) => {
  if (!requireRole(req.user, 'student', res)) return;
  const student = row('SELECT * FROM students WHERE user_id = ?', req.user.sub);
  const cert = row('SELECT * FROM certificates WHERE id = ? AND student_id = ?', req.params.id, student.id);
  if (!cert) return res.sendJson(404, { error: 'Certificate not found.' });
  const b = req.body;
  if (!b.name) return res.sendJson(400, { error: 'Certificate name is required.' });
  run('UPDATE certificates SET name=?, issuer=?, issue_date=?, credential_id=?, url=? WHERE id=?', b.name, b.issuer || '', b.issueDate || '', b.credentialId || '', b.url || '', cert.id);
  res.sendJson(200, { certificate: row('SELECT * FROM certificates WHERE id = ?', cert.id) });
});
route('DELETE', '/api/certificates/:id', async (req, res) => {
  if (!requireRole(req.user, 'student', res)) return;
  const student = row('SELECT * FROM students WHERE user_id = ?', req.user.sub);
  const cert = row('SELECT * FROM certificates WHERE id = ? AND student_id = ?', req.params.id, student.id);
  if (!cert) return res.sendJson(404, { error: 'Certificate not found.' });
  run('DELETE FROM certificates WHERE id = ?', cert.id);
  res.sendJson(200, { ok: true });
});

/* ---------------------------- NOTIFICATIONS ---------------------------- */

route('GET', '/api/notifications/mine', async (req, res) => {
  if (!requireAuth(req.user, res)) return;
  res.sendJson(200, { notifications: all('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50', req.user.sub) });
});

/* ---------------------------- ADMIN ---------------------------- */

route('GET', '/api/public/stats', async (req, res) => {
  res.sendJson(200, {
    students: row('SELECT COUNT(*) c FROM students').c,
    recruiters: row("SELECT COUNT(*) c FROM recruiters WHERE status='approved'").c,
    jobs: row("SELECT COUNT(*) c FROM jobs WHERE status='open'").c,
    selected: row("SELECT COUNT(*) c FROM applications WHERE status='Selected'").c
  });
});

route('GET', '/api/admin/stats', async (req, res) => {
  if (!requireRole(req.user, 'admin', res)) return;
  res.sendJson(200, {
    students: row('SELECT COUNT(*) c FROM students').c,
    recruiters: row("SELECT COUNT(*) c FROM recruiters WHERE status='approved'").c,
    pendingRecruiters: row("SELECT COUNT(*) c FROM recruiters WHERE status='pending'").c,
    jobs: row('SELECT COUNT(*) c FROM jobs').c,
    applications: row('SELECT COUNT(*) c FROM applications').c,
    selected: row("SELECT COUNT(*) c FROM applications WHERE status='Selected'").c
  });
});
route('GET', '/api/admin/recruiters', async (req, res) => {
  if (!requireRole(req.user, 'admin', res)) return;
  res.sendJson(200, { recruiters: all('SELECT * FROM recruiters ORDER BY created_at DESC').map(recruiterOut) });
});
route('PATCH', '/api/admin/recruiters/:id/status', async (req, res) => {
  if (!requireRole(req.user, 'admin', res)) return;
  const rec = row('SELECT * FROM recruiters WHERE id = ?', req.params.id);
  if (!rec) return res.sendJson(404, { error: 'Recruiter not found.' });
  const status = req.body.status;
  run('UPDATE recruiters SET status=? WHERE id=?', status, rec.id);
  if (status === 'approved') await sendMail({ to: rec.email, ...TEMPLATES.recruiterApproved(rec.recruiter_name, rec.company_name) });
  addAudit(req.user.sub, 'recruiter_status_changed', { id: rec.id, status });
  res.sendJson(200, { recruiter: recruiterOut(row('SELECT * FROM recruiters WHERE id = ?', rec.id)) });
});
route('GET', '/api/admin/students', async (req, res) => {
  if (!requireRole(req.user, 'admin', res)) return;
  res.sendJson(200, { students: all('SELECT * FROM students ORDER BY full_name').map(studentOut) });
});
route('GET', '/api/admin/jobs', async (req, res) => {
  if (!requireRole(req.user, 'admin', res)) return;
  res.sendJson(200, { jobs: all('SELECT * FROM jobs ORDER BY created_at DESC').map(jobOut) });
});
route('GET', '/api/admin/applications', async (req, res) => {
  if (!requireRole(req.user, 'admin', res)) return;
  const apps = all('SELECT * FROM applications ORDER BY applied_at DESC');
  res.sendJson(200, { applications: apps.map(a => {
    const s = row('SELECT full_name FROM students WHERE id = ?', a.student_id);
    const j = row('SELECT role, company FROM jobs WHERE id = ?', a.job_id);
    return { ...appOut(a), studentName: s ? s.full_name : 'Unknown', jobRole: j ? j.role : 'Unknown', jobCompany: j ? j.company : 'Unknown' };
  }) });
});
route('GET', '/api/admin/admins', async (req, res) => {
  if (!requireRole(req.user, 'admin', res)) return;
  res.sendJson(200, { admins: all('SELECT id, name, email, status, created_by, created_at FROM admins ORDER BY email') });
});
route('POST', '/api/admin/admins', async (req, res) => {
  if (!requireRole(req.user, 'admin', res)) return;
  const activeCount = row("SELECT COUNT(*) c FROM admins WHERE status='active'").c;
  if (activeCount >= 3) return res.sendJson(409, { error: 'Maximum administrator limit reached (3/3).' });
  const { name, email, password } = req.body;
  if (!name || !isValidEmail(email) || !password || password.length < 6) return res.sendJson(400, { error: 'Valid name, email, and a password (6+ chars) are required.' });
  if (row('SELECT id FROM admins WHERE email = ?', email.toLowerCase())) return res.sendJson(409, { error: 'An administrator with this email already exists.' });
  const { hash, salt } = hashPassword(password);
  const id = uid('admin');
  const actingAdmin = row('SELECT email FROM admins WHERE id = ?', req.user.sub);
  run('INSERT INTO admins (id, name, email, password_hash, password_salt, status, created_by) VALUES (?,?,?,?,?,?,?)', id, name.trim(), email.toLowerCase(), hash, salt, 'active', actingAdmin ? actingAdmin.email : 'unknown');
  addAudit(req.user.sub, 'admin_created', { id });
  res.sendJson(201, { admin: row('SELECT id, name, email, status, created_by, created_at FROM admins WHERE id = ?', id) });
});
route('PATCH', '/api/admin/admins/:id/status', async (req, res) => {
  if (!requireRole(req.user, 'admin', res)) return;
  const target = row('SELECT * FROM admins WHERE id = ?', req.params.id);
  if (!target) return res.sendJson(404, { error: 'Administrator not found.' });
  const status = req.body.status === 'active' ? 'active' : 'deactivated';
  if (status === 'active') {
    const activeCount = row("SELECT COUNT(*) c FROM admins WHERE status='active'").c;
    if (activeCount >= 3) return res.sendJson(409, { error: 'Maximum administrator limit reached (3/3).' });
  }
  run('UPDATE admins SET status=? WHERE id=?', status, target.id);
  addAudit(req.user.sub, 'admin_status_changed', { id: target.id, status });
  res.sendJson(200, { admin: row('SELECT id, name, email, status, created_by, created_at FROM admins WHERE id = ?', target.id) });
});

/* ---------------------------- AI ---------------------------- */

route('POST', '/api/ai/chat', async (req, res) => {
  if (!requireAuth(req.user, res)) return;
  const { message } = req.body;
  if (!message) return res.sendJson(400, { error: 'message is required.' });
  let context = '';
  if (req.user.role === 'student') {
    const s = row('SELECT * FROM students WHERE user_id = ?', req.user.sub);
    if (s) context = `Student profile — Name: ${s.full_name}, Department: ${s.department}, CGPA: ${s.cgpa}, Skills: ${JSON.parse(s.skills_json || '[]').join(', ') || 'none listed'}, Career Goal: ${s.career_goal || 'not set'}.`;
  }
  const result = await callAiProvider(message, `You are UCASION, the AI career assistant for UCAS CareerSync AI. Be concise and helpful. ${context}`);
  res.sendJson(200, result);
});

/* ---------------------------- HEALTH ---------------------------- */

route('GET', '/api/health', async (req, res) => {
  let dbOk = false;
  try { row('SELECT 1 as x'); dbOk = true; } catch (e) { dbOk = false; }
  res.sendJson(dbOk ? 200 : 503, { status: dbOk ? 'ok' : 'degraded', database: dbOk ? 'connected' : 'unreachable', aiConfigured: !!process.env.AI_PROVIDER, emailConfigured: isEmailConfigured(), timestamp: new Date().toISOString() });
});

module.exports = { matchRoute, requireAuth, requireRole };
