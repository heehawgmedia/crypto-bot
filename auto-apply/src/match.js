// Scores a job against the profile's search preferences.
// +1 per matched keyword in the title, +0.5 per match in the description,
// hard-reject on excluded keywords or non-remote when remoteOnly is set.
export function scoreJob(job, search) {
  const title = (job.title || '').toLowerCase();
  const desc = (job.description || '').toLowerCase();
  const loc = (job.location || '').toLowerCase();

  for (const bad of search.excludeKeywords || []) {
    if (title.includes(bad.toLowerCase())) return { score: -1, reason: `excluded keyword "${bad}"` };
  }

  const isRemote = loc.includes('remote') || job.remote === true;
  if (search.remoteOnly && !isRemote) {
    const locOk = (search.locations || []).some((l) => l !== 'remote' && loc.includes(l.toLowerCase()));
    if (!locOk) return { score: -1, reason: `not remote and not in ${JSON.stringify(search.locations)}` };
  }

  let score = 0;
  const hits = [];
  for (const kw of search.keywords || []) {
    const k = kw.toLowerCase();
    if (title.includes(k)) { score += 1; hits.push(kw); }
    else if (desc.includes(k)) { score += 0.5; hits.push(kw); }
  }
  return { score, reason: hits.length ? `matched: ${hits.join(', ')}` : 'no keyword matches' };
}
