// Drives a Playwright browser through a Greenhouse or Lever application form.
//
// Modes:
//   dry-run (default): fill the form, screenshot it, DO NOT submit.
//   submit:            fill and actually click submit.
//
// The applier never bypasses CAPTCHAs — if one is present the job is marked
// skipped_captcha for you to finish by hand (the filled form stays useful).
import { chromium } from 'playwright';
import path from 'node:path';
import { ROOT } from '../config.js';
import { fillKnownFields, detectCaptcha } from './fill.js';

const SHOTS = path.join(ROOT, 'data', 'screenshots');

export async function applyToJob(job, profile, { submit = false } = {}) {
  // AUTO_APPLY_CHROME lets you point at an existing Chromium/Chrome binary
  // instead of the Playwright-managed download.
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.AUTO_APPLY_CHROME ? { executablePath: process.env.AUTO_APPLY_CHROME } : {}),
  });
  const page = await browser.newPage();
  try {
    const applyUrl = getApplyUrl(job);
    await page.goto(applyUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(2000);

    // Resume upload first — some ATSs parse it and pre-fill fields.
    const uploaded = await uploadResume(page, profile);

    const { filled, unknown } = await fillKnownFields(page, profile);

    if (await detectCaptcha(page)) {
      const shot = await screenshot(page, job, 'captcha');
      return { outcome: 'skipped_captcha', filled, unknown, uploaded, screenshot: shot,
        note: 'CAPTCHA present — finish this one manually in a browser.' };
    }

    if (unknown.length > 0) {
      const shot = await screenshot(page, job, 'needs-review');
      return { outcome: 'needs_review', filled, unknown, uploaded, screenshot: shot,
        note: `Required questions I could not answer: ${unknown.join(' | ')}. Add answers under "answers.custom" in profile.json.` };
    }

    if (!submit) {
      const shot = await screenshot(page, job, 'dry-run');
      return { outcome: 'dry_run', filled, unknown, uploaded, screenshot: shot,
        note: 'Dry run — form filled but NOT submitted. Re-run with --submit to send.' };
    }

    const submitted = await clickSubmit(page, job);
    const shot = await screenshot(page, job, submitted ? 'submitted' : 'submit-failed');
    return submitted
      ? { outcome: 'applied', filled, uploaded, screenshot: shot }
      : { outcome: 'failed', filled, uploaded, screenshot: shot, note: 'Could not find/confirm the submit action.' };
  } finally {
    await browser.close();
  }
}

function getApplyUrl(job) {
  if (job.source === 'greenhouse') return `${job.url}#app`;
  if (job.source === 'lever') return job.applyUrl || `${job.url}/apply`;
  return job.applyUrl || job.url;
}

async function uploadResume(page, profile) {
  const inputs = page.locator('input[type="file"]');
  const count = await inputs.count();
  let resumeDone = false;
  let coverDone = false;
  for (let i = 0; i < count; i++) {
    const input = inputs.nth(i);
    const name = ((await input.getAttribute('name')) || '') + ' ' + ((await input.getAttribute('id')) || '');
    if (!resumeDone && /resume|cv/i.test(name)) {
      await input.setInputFiles(profile.resumePath).catch(() => {});
      resumeDone = true;
    } else if (!coverDone && /cover/i.test(name) && profile.coverLetterPath) {
      await input.setInputFiles(profile.coverLetterPath).catch(() => {});
      coverDone = true;
    }
  }
  // Fallback: single unlabeled file input -> assume resume
  if (!resumeDone && count === 1) {
    await inputs.first().setInputFiles(profile.resumePath).catch(() => {});
    resumeDone = true;
  }
  if (resumeDone) await page.waitForTimeout(3000); // let ATS parse it
  return resumeDone;
}

async function clickSubmit(page, job) {
  const candidates = [
    'button[type="submit"]',
    'input[type="submit"]',
    'button:has-text("Submit application")',
    'button:has-text("Submit Application")',
    'button:has-text("Submit")',
  ];
  for (const sel of candidates) {
    const btn = page.locator(sel).first();
    if ((await btn.count()) && (await btn.isVisible().catch(() => false))) {
      await btn.click();
      await page.waitForTimeout(5000);
      const body = (await page.textContent('body').catch(() => '')) || '';
      if (/thank|received|submitted|confirmation/i.test(body)) return true;
      // Page may have navigated to a confirmation URL instead
      if (/confirmation|thanks/i.test(page.url())) return true;
      // Submission may still have worked without recognizable copy — treat
      // an absent form as success.
      const formStillThere = await page.locator('form').count();
      return formStillThere === 0;
    }
  }
  return false;
}

async function screenshot(page, job, tag) {
  const { mkdirSync } = await import('node:fs');
  mkdirSync(SHOTS, { recursive: true });
  const file = path.join(SHOTS, `${job.id.replace(/[^a-z0-9]+/gi, '-')}-${tag}.png`);
  await page.screenshot({ path: file, fullPage: true }).catch(() => {});
  return file;
}
