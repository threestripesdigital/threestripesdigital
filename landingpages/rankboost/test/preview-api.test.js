import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequest } from '../functions/_middleware.js';

const origin = 'https://tsd-law-firm-rank-boost.pages.dev';
const preview = 'https://rankboost-inline-booking.tsd-law-firm-rank-boost.pages.dev';
test('preview forwards only public POST APIs to the fixed configured backend', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async request => {
    calls.push(request);
    assert.equal(request.headers.get('Origin'), preview);
    assert.equal(request.headers.get('X-Router-Token'), null);
    assert.equal(request.headers.get('X-Forwarded-Client-IP'), null);
    assert.equal(request.headers.get('Authorization'), null);
    assert.deepEqual(await request.json(), { event_id: 'existing-submission' });
    return Response.json({ qualified: true });
  };
  try {
    for (const path of ['/api/check', '/api/booking', '/api/track']) {
      const response = await onRequest({
        request: new Request(preview + path, { method: 'POST', headers: {
          Origin: preview, 'Content-Type': 'application/json',
          'X-Router-Token': 'spoof', 'X-Forwarded-Client-IP': 'spoof', Authorization: 'spoof',
        }, body: JSON.stringify({ event_id: 'existing-submission' }) }),
        env: { FUNNEL_API_ORIGIN: origin },
        next: () => { throw new Error('Must use configured backend'); },
      });
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('Cache-Control'), 'no-store');
      assert.equal(calls.at(-1).url, origin + path);
    }
    for (const [url, method, upstream] of [
      [preview + '/api/leads', 'POST', origin],
      [preview + '/api/process-jobs', 'POST', origin],
      [preview + '/api/check', 'GET', origin],
      [origin + '/api/check', 'POST', origin],
      [preview + '/api/check', 'POST', 'https://example.com'],
    ]) {
      const response = await onRequest({request:new Request(url,{method}),env:{FUNNEL_API_ORIGIN:upstream},next:()=>Response.json({local:true})});
      assert.deepEqual(await response.json(),{local:true});
    }
    assert.equal(calls.length,3);
  } finally { globalThis.fetch=originalFetch; }
});
