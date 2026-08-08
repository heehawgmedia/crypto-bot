// RemoteOK public API: https://remoteok.com/api (all remote jobs, first element is metadata)
// RemoteOK jobs link out to each company's own application page, so they can't be
// auto-filled generically — they're surfaced for discovery and open in the tracker
// with their apply URL.
export async function fetchRemoteOKJobs() {
  const res = await fetch('https://remoteok.com/api', {
    headers: { 'User-Agent': 'auto-apply-personal-job-tracker' },
  });
  if (!res.ok) throw new Error(`RemoteOK: HTTP ${res.status}`);
  const data = await res.json();
  return data
    .filter((j) => j && j.id && j.position)
    .map((j) => ({
      id: `remoteok:${j.id}`,
      source: 'remoteok',
      externalId: String(j.id),
      title: j.position,
      company: j.company || '',
      location: j.location || 'Remote',
      remote: true,
      url: j.url,
      applyUrl: j.apply_url || j.url,
      description: (j.description || '').replace(/<[^>]+>/g, ' ').slice(0, 5000),
    }));
}
