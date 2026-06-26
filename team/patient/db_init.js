const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

async function main() {
  const sqlPath = path.join(__dirname, '..', 'database.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');

  const conn = await mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: '',
  });

  await conn.query('CREATE DATABASE IF NOT EXISTS dental_clinic');

  await conn.query('USE dental_clinic');

  const trimmed = sql.trim();

  const statements = trimmed
    .split(/;\s*\r?\n/)
    .map(s => s.trim())
    .filter(Boolean)
    .map(s => (s.endsWith(';') ? s : s + ';'));

  for (const stmt of statements) {
    if (/^CREATE\s+DATABASE\s+dental_clinic/i.test(stmt)) continue;
    if (/^USE\s+dental_clinic/i.test(stmt)) continue;

    try {
      await conn.query(stmt);
    } catch (e) {
      if (e && (e.code === 'ER_TABLE_EXISTS_ERROR' || e.code === 'ER_DUP_FIELDNAME')) {
        continue;
      }
      throw e;
    }
  }

  await conn.end();
  console.log('MySQL schema init complete (dental_clinic).');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

