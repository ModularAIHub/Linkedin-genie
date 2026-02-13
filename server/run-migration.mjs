import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pool } from './config/database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const migrationsDir = path.join(__dirname, 'migrations');

const migrationArg = process.argv[2];

const loadMigrationFiles = () => {
  const allFiles = fs.readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.sql'))
    .sort();

  if (!migrationArg || migrationArg === '--all') {
    return allFiles;
  }

  const normalized = migrationArg.endsWith('.sql') ? migrationArg : `${migrationArg}.sql`;
  if (!allFiles.includes(normalized)) {
    throw new Error(`Migration file not found: ${normalized}`);
  }

  return [normalized];
};

const ensureMigrationsTable = async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY,
      executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
};

const getExecutedMigrations = async () => {
  const { rows } = await pool.query('SELECT filename FROM schema_migrations');
  return new Set(rows.map((row) => row.filename));
};

const runMigrations = async () => {
  const files = loadMigrationFiles();
  await ensureMigrationsTable();

  const executed = await getExecutedMigrations();

  for (const filename of files) {
    if (!migrationArg && executed.has(filename)) {
      console.log(`[migration] skipping already executed: ${filename}`);
      continue;
    }

    const fullPath = path.join(migrationsDir, filename);
    const sql = fs.readFileSync(fullPath, 'utf8');

    console.log(`[migration] running: ${filename}`);
    await pool.query('BEGIN');
    try {
      await pool.query(sql);
      await pool.query(
        'INSERT INTO schema_migrations (filename, executed_at) VALUES ($1, NOW()) ON CONFLICT (filename) DO NOTHING',
        [filename]
      );
      await pool.query('COMMIT');
      console.log(`[migration] success: ${filename}`);
    } catch (error) {
      await pool.query('ROLLBACK');
      throw new Error(`Migration failed (${filename}): ${error.message}`);
    }
  }
};

runMigrations()
  .then(() => {
    console.log('Migration run completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Migration run failed:', error.message);
    process.exit(1);
  })
  .finally(async () => {
    await pool.end();
  });
