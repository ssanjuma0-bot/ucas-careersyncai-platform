const { migrate, DB_PATH } = require('./db');
try {
  migrate();
  console.log('Migration complete. Database file:', DB_PATH);
  process.exit(0);
} catch (e) {
  console.error('Migration failed:', e);
  process.exit(1);
}
