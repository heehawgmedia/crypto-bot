// Lever public postings API: https://api.lever.co/v0/postings/{company}?mode=json
export async function fetchLeverJobs(company) {
  const url = `https://api.lever.co/v0/postings/${company}?mode=json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Lever company "${company}": HTTP ${res.status}`);
  const data = await res.json();
  return (data || []).map((j) => ({
    id: `lever:${company}:${j.id}`,
    source: 'lever',
    board: company,
    externalId: j.id,
    title: j.text,
    company,
    location: j.categories?.location || '',
    remote: j.workplaceType === 'remote',
    url: j.hostedUrl,
    applyUrl: j.applyUrl || `${j.hostedUrl}/apply`,
    description: (j.descriptionPlain || '').slice(0, 5000),
  }));
}
