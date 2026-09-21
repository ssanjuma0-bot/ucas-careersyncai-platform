function jobMatchScore(student, job) {
  const studentSkills = (JSON.parse(student.skills_json || '[]')).map(s => s.trim().toLowerCase());
  const reqSkills = (JSON.parse(job.skills_json || '[]')).map(s => s.trim().toLowerCase());
  let skillScore = 0;
  if (reqSkills.length) {
    const matches = reqSkills.filter(s => studentSkills.includes(s));
    skillScore = matches.length / reqSkills.length;
  }
  let goalScore = 0;
  const goal = (student.career_goal || '').toLowerCase();
  if (goal && job.role && job.role.toLowerCase().includes(goal.split(' ')[0])) goalScore = 1;
  let locScore = 0;
  if (student.preferred_location && job.location) {
    locScore = student.preferred_location.toLowerCase() === job.location.toLowerCase() ? 1 : (job.work_mode === 'Remote' ? 0.6 : 0);
  }
  let cgpaScore = 1;
  if (job.min_cgpa && student.cgpa) { cgpaScore = Number(student.cgpa) >= Number(job.min_cgpa) ? 1 : 0.3; }
  const weighted = (skillScore * 0.55) + (goalScore * 0.2) + (locScore * 0.1) + (cgpaScore * 0.15);
  return Math.round(weighted * 100);
}
module.exports = { jobMatchScore };
