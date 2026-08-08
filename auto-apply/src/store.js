// Simple JSON-file store that tracks every job seen and its lifecycle:
// found -> approved/rejected -> applied/failed/needs_review
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DB_PATH = path.join(ROOT, 'data', 'jobs.json');

export const STATUSES = ['found', 'approved', 'rejected', 'applied', 'failed', 'needs_review', 'skipped_captcha'];

function load() {
  if (!fs.existsSync(DB_PATH)) return { jobs: {} };
  return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
}

function save(db) {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

export function upsertJobs(jobs) {
  const db = load();
  let added = 0;
  for (const job of jobs) {
    if (!db.jobs[job.id]) {
      db.jobs[job.id] = { ...job, status: 'found', foundAt: new Date().toISOString() };
      added++;
    }
  }
  save(db);
  return added;
}

export function listJobs(status) {
  const db = load();
  const all = Object.values(db.jobs);
  return status ? all.filter((j) => j.status === status) : all;
}

export function setStatus(id, status, extra = {}) {
  const db = load();
  if (!db.jobs[id]) throw new Error(`Unknown job id: ${id}`);
  Object.assign(db.jobs[id], { status, ...extra, updatedAt: new Date().toISOString() });
  save(db);
}

export function getJob(id) {
  const db = load();
  return db.jobs[id];
}
