const BASE = 'http://localhost:4000';
let pass = 0, fail = 0;
function check(name, cond, extra) { if (cond) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, extra ?? ''); } }
async function api(method, path, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = 'Bearer ' + token;
  const resp = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let json = null; try { json = await resp.json(); } catch (e) {}
  return { status: resp.status, json };
}

(async () => {
  const health = await api('GET', '/api/health');
  check('health check returns ok with real DB check', health.status === 200 && health.json.database === 'connected', JSON.stringify(health.json));

  const email = 'test.student.' + Date.now() + '@ucas.edu.in';
  const reg = await api('POST', '/api/auth/register/student', { fullName: 'Test Student', studentIdNo: 'TESTID' + Date.now(), email, password: 'TestPass123', mobile: '9876543210', dob: '2003-01-01', gender: 'Male', course: 'B.Sc CSDA', year: '3', cgpa: '8.0', careerGoal: 'Data Analyst', skills: ['Excel', 'SQL', 'Python'] });
  check('student registration succeeds with real DB write', reg.status === 201 && !!reg.json.token, JSON.stringify(reg.json));
  const studentToken = reg.json.token;

  const dup = await api('POST', '/api/auth/register/student', { fullName: 'Dup', studentIdNo: 'DUPID', email, password: 'TestPass123' });
  check('duplicate email registration blocked (409)', dup.status === 409);

  const wrongLogin = await api('POST', '/api/auth/login', { email, password: 'wrong', role: 'student' });
  check('wrong password rejected (401)', wrongLogin.status === 401);

  const login = await api('POST', '/api/auth/login', { email, password: 'TestPass123', role: 'student' });
  check('correct login succeeds and returns real JWT', login.status === 200 && login.json.token.split('.').length === 3);

  const noAuth = await api('GET', '/api/students/me');
  check('unauthenticated request rejected (401)', noAuth.status === 401);

  const me = await api('GET', '/api/students/me', null, studentToken);
  check('authenticated profile fetch returns real saved data', me.status === 200 && me.json.student.fullName === 'Test Student');

  const recEmail = 'test.recruiter.' + Date.now() + '@novacorp.com';
  const recReg = await api('POST', '/api/auth/register/recruiter', { companyName: 'NovaCorp Test', recruiterName: 'Test Recruiter', email: recEmail, password: 'RecPass123', phone: '9876500000' });
  check('recruiter registration succeeds', recReg.status === 201);
  const recLoginBlocked = await api('POST', '/api/auth/login', { email: recEmail, password: 'RecPass123', role: 'recruiter' });
  check('unapproved recruiter login blocked (403)', recLoginBlocked.status === 403 && recLoginBlocked.json.status === 'pending');

  const { db } = require('./db');
  const { hashPassword } = require('./lib/auth');
  const { uid } = require('./lib/util');
  const { hash, salt } = hashPassword('AdminPass123');
  const adminId = uid('admin');
  const adminEmail = 'test.admin.' + Date.now() + '@ucas.edu.in';
  db.prepare('INSERT INTO admins (id, name, email, password_hash, password_salt, status) VALUES (?,?,?,?,?,?)').run(adminId, 'Test Admin', adminEmail, hash, salt, 'active');

  const adminLogin = await api('POST', '/api/auth/login', { email: adminEmail, password: 'AdminPass123', role: 'admin' });
  check('admin login succeeds', adminLogin.status === 200 && !!adminLogin.json.token);
  const adminToken = adminLogin.json.token;

  const recId = recReg.json.recruiter.id;
  const approve = await api('PATCH', `/api/admin/recruiters/${recId}/status`, { status: 'approved' }, adminToken);
  check('admin can approve recruiter (real DB update)', approve.status === 200 && approve.json.recruiter.status === 'approved');

  const recLogin2 = await api('POST', '/api/auth/login', { email: recEmail, password: 'RecPass123', role: 'recruiter' });
  check('approved recruiter can now log in', recLogin2.status === 200 && !!recLogin2.json.token);
  const recruiterToken = recLogin2.json.token;

  const jobCreate = await api('POST', '/api/jobs', { role: 'Data Analyst', location: 'Coimbatore', workMode: 'Hybrid', salaryMin: 25000, salaryMax: 40000, skills: ['Excel', 'SQL', 'Power BI'], experience: 'Fresher', minCgpa: 6, description: 'Real job for integration test.', requirements: 'SQL and Excel required.', deadline: '2026-12-31', vacancies: 2 }, recruiterToken);
  check('recruiter can create a real job', jobCreate.status === 201 && !!jobCreate.json.job.id);
  const jobId = jobCreate.json.job.id;

  const jobsList = await api('GET', '/api/jobs');
  check('job appears in public marketplace immediately', jobsList.status === 200 && jobsList.json.jobs.some(j => j.id === jobId));

  const putJob = await api('PUT', `/api/jobs/${jobId}`, { role: 'Updated Analyst Role' }, recruiterToken);
  check('recruiter can edit own job', putJob.status === 200 && putJob.json.job.role === 'Updated Analyst Role');

  const apply = await api('POST', '/api/applications', { jobId, applicationData: { coverLetter: 'I am interested.' } }, studentToken);
  check('student can apply, real match score computed from real skills', apply.status === 201 && apply.json.application.matchScore > 0);

  const dupApply = await api('POST', '/api/applications', { jobId }, studentToken);
  check('duplicate application blocked (409)', dupApply.status === 409);

  const myApps = await api('GET', '/api/applications/mine', null, studentToken);
  check('student sees own application in real DB', myApps.status === 200 && myApps.json.applications.length === 1);

  const applicants = await api('GET', `/api/jobs/${jobId}/applicants`, null, recruiterToken);
  check('recruiter sees real applicant profile (not fake data)', applicants.status === 200 && applicants.json.applicants[0].student.fullName === 'Test Student');
  const appId = applicants.json.applicants[0].application.id;

  const shortlist = await api('PATCH', `/api/applications/${appId}/status`, { status: 'Shortlisted' }, recruiterToken);
  check('recruiter can update application status', shortlist.status === 200 && shortlist.json.application.status === 'Shortlisted');

  const iv = await api('POST', '/api/interviews', { applicationId: appId, date: '2026-10-15T10:00:00Z', type: 'Technical', mode: 'Online', link: 'https://meet.example.com/x' }, recruiterToken);
  check('recruiter can schedule real interview', iv.status === 201 && !!iv.json.interview.id);

  const myInterviews = await api('GET', '/api/interviews/mine', null, studentToken);
  check('student sees scheduled interview', myInterviews.status === 200 && myInterviews.json.interviews.length === 1);

  const appsAfterIv = await api('GET', '/api/applications/mine', null, studentToken);
  check('application status auto-updates to Interview Scheduled', appsAfterIv.json.applications[0].status === 'Interview Scheduled');

  const notifs = await api('GET', '/api/notifications/mine', null, studentToken);
  check('student has real notifications from actual events', notifs.status === 200 && notifs.json.notifications.length >= 3);

  const certCreate = await api('POST', '/api/certificates', { name: 'Google Data Analytics', issuer: 'Google', credentialId: 'GDA-1' }, studentToken);
  check('certificate creation persists to real DB', certCreate.status === 201);
  const certList = await api('GET', '/api/certificates/mine', null, studentToken);
  check('certificate list reflects real DB state', certList.json.certificates.length === 1);
  const putCert = await api('PUT', `/api/certificates/${certList.json.certificates[0].id}`, { name: 'Google Data Analytics Pro' }, studentToken);
  check('certificate edit works', putCert.status === 200 && putCert.json.certificate.name === 'Google Data Analytics Pro');
  const certDel = await api('DELETE', `/api/certificates/${certList.json.certificates[0].id}`, null, studentToken);
  check('certificate deletion works', certDel.status === 200);

  const stats = await api('GET', '/api/admin/stats', null, adminToken);
  check('admin stats computed from real DB counts', stats.status === 200 && stats.json.students >= 1 && stats.json.jobs >= 1);

  const adminJobs = await api('GET', '/api/admin/jobs', null, adminToken);
  check('admin can view all jobs', adminJobs.status === 200 && adminJobs.json.jobs.length >= 1);
  const adminApps = await api('GET', '/api/admin/applications', null, adminToken);
  check('admin can view all applications with names', adminApps.status === 200 && adminApps.json.applications[0].studentName === 'Test Student');

  const forbidden = await api('GET', '/api/admin/stats', null, studentToken);
  check('student blocked from admin routes (403)', forbidden.status === 403);

  const rec2Email = 'test.recruiter2.' + Date.now() + '@othercorp.com';
  await api('POST', '/api/auth/register/recruiter', { companyName: 'OtherCorp', recruiterName: 'Other Rec', email: rec2Email, password: 'Other123', phone: '9800000000' });
  const rec2Row = db.prepare('SELECT id FROM recruiters WHERE email = ?').get(rec2Email.toLowerCase());
  db.prepare("UPDATE recruiters SET status='approved' WHERE id=?").run(rec2Row.id);
  const rec2Login = await api('POST', '/api/auth/login', { email: rec2Email, password: 'Other123', role: 'recruiter' });
  const crossAccess = await api('GET', `/api/jobs/${jobId}/applicants`, null, rec2Login.json.token);
  check("recruiter cannot view another recruiter's job applicants (404, not leaked)", crossAccess.status === 404);

  const ai = await api('POST', '/api/ai/chat', { message: 'What skills should I learn?' }, studentToken);
  check('AI endpoint honestly reports not-configured when no key set', ai.status === 200 && ai.json.configured === false && ai.json.error.includes('not configured'));

  const notFound = await api('GET', '/api/does-not-exist');
  check('unknown route returns 404', notFound.status === 404);

  console.log(`\n=== ${pass}/${pass + fail} passed ===`);
  process.exit(fail > 0 ? 1 : 0);
})();
