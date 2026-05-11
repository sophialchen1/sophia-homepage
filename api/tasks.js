const https = require('https');

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const DATABASE_ID  = 'd88624c54f2944e59b84762b81b086dd';

function notionRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = https.request({
      hostname: 'api.notion.com',
      path,
      method,
      headers: {
        'Authorization': `Bearer ${NOTION_TOKEN}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {})
      }
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { reject(new Error('Invalid JSON from Notion')); }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function pageToTask(page) {
  const p = page.properties;
  const name = (p['Task']?.title || []).map(t => t.plain_text).join('');
  const status = p['Status']?.select?.name || 'Open';
  const tag = p['Tag']?.select?.name || null;
  const priority = p['Priority']?.select?.name || null;
  const dueDateRaw = p['Due Date']?.date?.start || null;
  let dueDate = null;
  if (dueDateRaw) {
    const d = new Date(dueDateRaw);
    dueDate = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
  return { id: page.id, name, status, tag, priority, dueDate, dueDateRaw };
}

function readBody(req) {
  return new Promise(resolve => {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => { try { resolve(JSON.parse(body)); } catch { resolve({}); } });
  });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.status(204).end(); return; }

  if (req.method === 'GET') {
    try {
      const data = await notionRequest('POST', `/v1/databases/${DATABASE_ID}/query`, {
        sorts: [{ property: 'Status', direction: 'ascending' }],
        page_size: 100
      });
      const tasks = (data.results || []).map(pageToTask).filter(t => t.name);
      res.status(200).json(tasks);
    } catch (e) { res.status(500).json({ error: e.message }); }
    return;
  }

  if (req.method === 'POST') {
    try {
      const { name, tag, priority, status } = await readBody(req);
      await notionRequest('POST', '/v1/pages', {
        parent: { database_id: DATABASE_ID },
        properties: {
          'Task': { title: [{ text: { content: name } }] },
          ...(tag      ? { 'Tag':      { select: { name: tag } } }      : {}),
          ...(priority ? { 'Priority': { select: { name: priority } } } : {}),
          ...(status   ? { 'Status':   { select: { name: status } } }   : {}),
        }
      });
      res.status(200).json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
    return;
  }

  if (req.method === 'PATCH') {
    try {
      const { id, status } = await readBody(req);
      await notionRequest('PATCH', `/v1/pages/${id}`, {
        properties: { 'Status': { select: { name: status } } }
      });
      res.status(200).json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
    return;
  }

  if (req.method === 'DELETE') {
    try {
      const { id } = await readBody(req);
      await notionRequest('PATCH', `/v1/pages/${id}`, { archived: true });
      res.status(200).json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
    return;
  }

  res.status(404).end();
};
