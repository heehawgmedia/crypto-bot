import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { db } from './models';

const migrationsDir = join(__dirname, '../../migrations');

async function runMigrations() {
  console.log('Running migrations...');

  // Get all .sql files sorted
  const files = readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const filePath = join(migrationsDir, file);
    const sql = readFileSync(filePath, 'utf-8');

    try {
      await db.query(sql);
      console.log(`✓ Applied migration: ${file}`);
    } catch (error) {
      console.error(`✗ Failed migration: ${file}`, error);
      throw error;
    }
  }

  console.log('All migrations completed.');
}

export { runMigrations };