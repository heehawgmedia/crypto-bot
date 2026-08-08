// Greenhouse public job board API: https://boards-api.greenhouse.io/v1/boards/{board}/jobs
export async function fetchGreenhouseJobs(board) {
  const url = `https://boards-api.greenhouse.io/v1/boards/${board}/jobs?content=true`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Greenhouse board "${board}": HTTP ${res.status}`);
  const data = await res.json();
  return (data.jobs || []).map((j) => ({
    id: `greenhouse:${board}:${j.id}`,
    source: 'greenhouse',
    board,
    externalId: String(j.id),
    title: j.title,
    company: board,
    location: j.location?.name || '',
    url: j.absolute_url,
    description: decodeEntities(j.content || '').replace(/<[^>]+>/g, ' ').slice(0, 5000),
  }));
}

function decodeEntities(html) {
  return html
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}
