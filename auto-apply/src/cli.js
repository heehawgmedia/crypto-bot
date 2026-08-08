#!/usr/bin/env node
// auto-apply — personal job application assistant
//
//   node src/cli.js search              pull jobs from configured sources, score & queue matches
//   node src/cli.js review              interactively approve/reject queued jobs
//   node src/cli.js apply               dry-run: fill forms for approved jobs, don't submit
//   node src/cli.js apply --submit      actually submit applications for approved jobs
//   node src/cli.js apply --id <id>     target one job
//   node src/cli.js status              show the tracker
import readline from 'node:readline/promises';
import { loadProfile } from './config.js';
import { scoreJob } from './match.js';
import { upsertJobs, listJobs, setStatus, getJob } from './store.js';
import { fetchGreenhouseJobs } from './sources/greenhouse.js';
import { fetchLeverJobs } from './sources/lever.js';
import { fetchRemoteOKJobs } from './sources/remoteok.js';

const [, , cmd, ...rest] = process.argv;
const flags = new Set(rest.filter((a) => a.startsWith('--')));
const idArg = rest.includes('--id') ? rest[rest.indexOf('--id') + 1] : null;

try {
  if (cmd === 'search') await search();
  else if (cmd === 'review') await review();
  else if (cmd === 'apply') await apply();
  else if (cmd === 'status') status();
  else usage();
} catch (err) {
  console.error(`\nError: ${err.message}`);
  process.exit(1);
}

function usage() {
  console.log(`auto-apply — job application assistant

Usage:
  node src/cli.js search                Find & queue matching jobs
  node src/cli.js review                Approve/reject queued jobs
  node src/cli.js apply [--submit]      Fill applications for approved jobs
                                        (dry-run unless --submit)
  node src/cli.js apply --id <id>       Apply to a single job
  node src/cli.js status                Show tracker summary

Setup: copy config/profile.example.json to config/profile.json,
fill it in, and place your resume at assets/resume.pdf`);
}

async function search() {
  const profile = loadProfile();
  const { search: prefs } = profile;
  const jobs = [];
  const errors = [];

  const tasks = [];
  for (const board of prefs.greenhouseBoards || []) {
    tasks.push(fetchGreenhouseJobs(board).catch((e) => { errors.push(e.message); return []; }));
  }
  for (const company of prefs.leverCompanies || []) {
    tasks.push(fetchLeverJobs(company).catch((e) => { errors.push(e.message); return []; }));
  }
  if (prefs.useRemoteOK) {
    tasks.push(fetchRemoteOKJobs().catch((e) => { errors.push(e.message); return []; }));
  }

  for (const batch of await Promise.all(tasks)) jobs.push(...batch);
  for (const msg of errors) console.warn(`  warning: ${msg}`);

  const matches = [];
  for (const job of jobs) {
    const { score, reason } = scoreJob(job, prefs);
    if (score >= (prefs.minScore ?? 1)) matches.push({ ...job, score, matchReason: reason });
  }
  matches.sort((a, b) => b.score - a.score);

  const added = upsertJobs(matches);
  console.log(`\nScanned ${jobs.length} jobs, ${matches.length} matched your criteria, ${added} new added to queue.`);
  console.log(`Next: node src/cli.js review`);
}

async function review() {
  const queued = listJobs('found');
  if (!queued.length) return console.log('Nothing to review. Run `search` first.');

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  console.log(`${queued.length} jobs to review. [y]=approve  [n]=reject  [s]=skip  [q]=quit\n`);
  for (const job of queued.sort((a, b) => b.score - a.score)) {
    console.log(`\n${job.title} @ ${job.company}  (score ${job.score})`);
    console.log(`  ${job.location || 'location n/a'} | ${job.matchReason}`);
    console.log(`  ${job.url}`);
    const ans = (await rl.question('  approve? [y/n/s/q] ')).trim().toLowerCase();
    if (ans === 'q') break;
    if (ans === 'y') setStatus(job.id, 'approved');
    else if (ans === 'n') setStatus(job.id, 'rejected');
  }
  rl.close();
  console.log(`\nApproved: ${listJobs('approved').length}. Next: node src/cli.js apply   (add --submit to actually send)`);
}

async function apply() {
  const profile = loadProfile();
  const submit = flags.has('--submit');
  const { applyToJob } = await import('./apply/applier.js');

  let targets;
  if (idArg) {
    const job = getJob(idArg);
    if (!job) throw new Error(`No job with id ${idArg}`);
    targets = [job];
  } else {
    targets = listJobs('approved');
  }
  if (!targets.length) return console.log('No approved jobs. Run `review` first, or pass --id <id>.');

  const supported = targets.filter((j) => j.source === 'greenhouse' || j.source === 'lever');
  const manual = targets.filter((j) => !supported.includes(j));
  if (manual.length) {
    console.log(`\n${manual.length} approved job(s) are on external sites and need manual application:`);
    for (const j of manual) console.log(`  - ${j.title} @ ${j.company}: ${j.applyUrl || j.url}`);
  }

  console.log(`\n${submit ? 'SUBMITTING' : 'DRY RUN (no submission)'} — ${supported.length} job(s)\n`);
  for (const job of supported) {
    process.stdout.write(`-> ${job.title} @ ${job.company} ... `);
    try {
      const result = await applyToJob(job, profile, { submit });
      const statusMap = { applied: 'applied', dry_run: 'approved', needs_review: 'needs_review', skipped_captcha: 'skipped_captcha', failed: 'failed' };
      setStatus(job.id, statusMap[result.outcome] || 'failed', { lastResult: result });
      console.log(result.outcome.toUpperCase());
      if (result.note) console.log(`   ${result.note}`);
      if (result.screenshot) console.log(`   screenshot: ${result.screenshot}`);
      await new Promise((r) => setTimeout(r, 5000 + Math.random() * 5000)); // pace requests politely
    } catch (err) {
      setStatus(job.id, 'failed', { lastError: err.message });
      console.log(`FAILED: ${err.message}`);
    }
  }
  status();
}

function status() {
  const all = listJobs();
  const by = {};
  for (const j of all) by[j.status] = (by[j.status] || 0) + 1;
  console.log('\nTracker:');
  for (const [s, n] of Object.entries(by)) console.log(`  ${s.padEnd(16)} ${n}`);
  const applied = listJobs('applied');
  if (applied.length) {
    console.log('\nApplied:');
    for (const j of applied) console.log(`  - ${j.title} @ ${j.company} (${j.updatedAt?.slice(0, 10)})`);
  }
  const review = listJobs('needs_review').concat(listJobs('skipped_captcha'));
  if (review.length) {
    console.log('\nNeeds your attention:');
    for (const j of review) console.log(`  - ${j.title} @ ${j.company}: ${j.lastResult?.note || j.status} -> ${j.url}`);
  }
}
