require('./db').migrate();
const { db } = require('./db');
const { hashPassword } = require('./lib/auth');
const { uid } = require('./lib/util');

const email = process.env.FIRST_ADMIN_EMAIL;
const password = process.env.FIRST_ADMIN_PASSWORD;
const name = process.env.FIRST_ADMIN_NAME || 'Administrator';

const existingCount = db.prepare('SELECT COUNT(*) c FROM admins').get().c;
if (existingCount > 0) { console.log(`An admin account already exists (${existingCount} total). Nothing to do.`); process.exit(0); }
if (!email || !password) {
  console.error('FIRST_ADMIN_EMAIL and FIRST_ADMIN_PASSWORD environment variables are required to create the first admin account.');
  console.error('Example: FIRST_ADMIN_EMAIL=admin@ucas.edu.in FIRST_ADMIN_PASSWORD="ChangeMe123!" npm run seed:admin');
  process.exit(1);
}
if (password.length < 8) { console.error('FIRST_ADMIN_PASSWORD must be at least 8 characters.'); process.exit(1); }

const { hash, salt } = hashPassword(password);
db.prepare('INSERT INTO admins (id, name, email, password_hash, password_salt, status, created_by) VALUES (?,?,?,?,?,?,?)')
  .run(uid('admin'), name, email.toLowerCase(), hash, salt, 'active', 'first-run-setup');
console.log(`First administrator account created: ${email}`);
console.log('You can now log in at /#/admin/login and create up to 2 more admins from the Admin Management page.');
