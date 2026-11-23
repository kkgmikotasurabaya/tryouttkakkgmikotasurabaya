export function createTursoClient(env) {
  const baseUrl = (env.TURSO_DATABASE_URL || '').replace(/^libsql:\/\//, 'https://');
  const token = env.TURSO_AUTH_TOKEN || '';

  const formatArg = (val) => {
    if (val === null || val === undefined) return { type: 'null' };
    if (typeof val === 'number') {
      return Number.isInteger(val)
        ? { type: 'integer', value: String(val) }
        : { type: 'float', value: val };
    }
    return { type: 'text', value: String(val) };
  };

  const parseRows = (result) => {
    if (!result || !result.cols || !result.rows) return [];
    const cols = result.cols.map((c) => c.name);
    return result.rows.map((row) => {
      const obj = {};
      row.forEach((cell, i) => {
        if (cell.type === 'null') obj[cols[i]] = null;
        else if (cell.type === 'integer' || cell.type === 'float') obj[cols[i]] = Number(cell.value);
        else obj[cols[i]] = cell.value;
      });
      return obj;
    });
  };

  const sendPipeline = async (requests) => {
    const res = await fetch(`${baseUrl}/v2/pipeline`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ requests: [...requests, { type: 'close' }] }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Turso HTTP Error (${res.status}): ${errText}`);
    }
    const json = await res.json();
    for (const r of json.results) {
      if (r.type === 'error') throw new Error(r.error.message || 'Turso Query Error');
    }
    return json.results;
  };

  return {
    async execute(query) {
      const sql = typeof query === 'string' ? query : query.sql;
      const args = typeof query === 'string' ? [] : (query.args || []).map(formatArg);
      const results = await sendPipeline([{ type: 'execute', stmt: { sql, args } }]);
      return { rows: parseRows(results[0]?.response?.result) };
    },
    async batch(statements) {
      const reqs = statements.map((s) => ({
        type: 'execute',
        stmt: { sql: s.sql, args: (s.args || []).map(formatArg) },
      }));
      await sendPipeline(reqs);
      return { success: true };
    },
  };
}

export async function signToken(payload, secret) {
  const enc = new TextEncoder();
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).replace(/=/g, '');
  const body = btoa(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + 6 * 3600 })).replace(/=/g, '');
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sigBuf = await crypto.subtle.sign('HMAC', key, enc.encode(`${header}.${body}`));
  const sig = btoa(String.fromCharCode(...new Uint8Array(sigBuf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  return `${header}.${body}.${sig}`;
}

export function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
