# auto-apply

A personal job-application assistant. It finds jobs matching your criteria from
public job APIs, scores them against your keywords, and auto-fills applications
on Greenhouse and Lever using your resume and profile — with you in the loop at
every step.

## How it works

```
search  ->  review  ->  apply (dry run)  ->  apply --submit
 find        you        fills forms +        actually
 & score     approve    screenshots,         submits
 jobs        each job   submits nothing
```

- **Sources:** Greenhouse boards and Lever companies you list (their public
  JSON APIs), plus the RemoteOK aggregator for discovery.
- **Auto-fill:** Playwright fills Greenhouse/Lever application forms — name,
  contact info, links, resume upload, and standard questions (salary, start
  date, "how did you hear about us", work authorization style questions via
  your configured answers).
- **Safety rails:**
  - Dry-run is the default; `--submit` is required to actually send anything.
  - Every job needs your explicit approval in `review` before it can be applied to.
  - If a form has a required question the tool can't answer, it stops, marks the
    job `needs_review`, and tells you the question so you can add an answer.
  - CAPTCHAs are never bypassed — those jobs are flagged for manual completion.
  - A screenshot of every filled form is saved to `data/screenshots/`.
- **Tracking:** every job and its status lives in `data/jobs.json`, so you never
  double-apply and always know where things stand.

## Setup

```bash
cd auto-apply
npm install                          # installs playwright

cp config/profile.example.json config/profile.json
# edit config/profile.json with your real info

# drop your resume here:
#   assets/resume.pdf
# optional cover letter:
#   assets/cover-letter.pdf
```

## Usage

```bash
node src/cli.js search           # pull + score jobs, queue matches
node src/cli.js review           # y/n through the queue
node src/cli.js apply            # DRY RUN: fill forms, screenshot, don't submit
node src/cli.js apply --submit   # actually submit approved applications
node src/cli.js apply --id <id>  # target one job
node src/cli.js status           # tracker summary
```

## Configuring your search

In `config/profile.json`:

- `search.keywords` — scored +1 for a title match, +0.5 for a description match
- `search.excludeKeywords` — any title hit rejects the job
- `search.minScore` — minimum score to enter your queue
- `search.greenhouseBoards` — board slugs from careers URLs like
  `boards.greenhouse.io/<slug>` or `job-boards.greenhouse.io/<slug>`
- `search.leverCompanies` — slugs from `jobs.lever.co/<slug>`
- `search.remoteOnly` / `search.locations`

## Custom questions

When a form has a required question the tool doesn't recognize, it marks the
job `needs_review` and prints the question. Add an answer under
`answers.custom` in `profile.json` — the key is matched (case-insensitive,
regex allowed) against the question text:

```json
"answers": {
  "custom": {
    "notice period": "2 weeks",
    "willing to relocate": "No, remote only"
  }
}
```

Then re-run `apply` for that job.

## Using an existing Chrome/Chromium

If you'd rather not download Playwright's browser (or are in an environment
with one pre-installed), point at a binary:

```bash
AUTO_APPLY_CHROME=/path/to/chrome node src/cli.js apply
```

## Notes & limits

- Greenhouse and Lever host public application forms and are what this tool can
  fill end-to-end. RemoteOK listings link to arbitrary external sites, so those
  are surfaced with their apply URL for you to finish manually.
- LinkedIn/Indeed "Easy Apply" automation is deliberately not included — both
  prohibit bots on their platforms and aggressively block them.
- Pace is throttled (5–10s between applications). Quality beats volume:
  a targeted queue you actually reviewed will outperform spray-and-pray.
