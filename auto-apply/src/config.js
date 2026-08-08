import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function loadProfile() {
  const userPath = path.join(ROOT, 'config', 'profile.json');
  const examplePath = path.join(ROOT, 'config', 'profile.example.json');
  if (!fs.existsSync(userPath)) {
    throw new Error(
      `No profile found. Copy ${examplePath} to ${userPath}, fill in your info, and drop your resume at auto-apply/assets/resume.pdf`
    );
  }
  const profile = JSON.parse(fs.readFileSync(userPath, 'utf8'));
  profile.resumePath = path.resolve(ROOT, profile.resume || './assets/resume.pdf');
  if (!fs.existsSync(profile.resumePath)) {
    throw new Error(`Resume not found at ${profile.resumePath} — put your resume PDF there or fix "resume" in profile.json`);
  }
  if (profile.coverLetter) {
    const cl = path.resolve(ROOT, profile.coverLetter);
    profile.coverLetterPath = fs.existsSync(cl) ? cl : null;
  }
  return profile;
}
