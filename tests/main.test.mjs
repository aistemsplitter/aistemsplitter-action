import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AIStemSplitterActionError,
  createSplit,
  getCredits,
  getInputs,
  runAction,
  waitForSplit,
} from '../src/main.js';

test('getInputs reads GitHub Action inputs from env', () => {
  const env = {
    INPUT_API_KEY: 'ast_test_123',
    INPUT_OPERATION: 'create-split',
    INPUT_AUDIO_URL: 'https://example.com/song.mp3',
    INPUT_STEM_MODEL: '6s',
    INPUT_OUTPUT_FORMAT: 'mp3',
    INPUT_WAIT: 'true',
    INPUT_TIMEOUT_SECONDS: '120',
    INPUT_API_BASE_URL: 'https://api.example.test/v1/',
  };

  assert.deepEqual(getInputs(env), {
    apiKey: 'ast_test_123',
    operation: 'create-split',
    audioUrl: 'https://example.com/song.mp3',
    stemModel: '6s',
    outputFormat: 'mp3',
    wait: true,
    timeoutSeconds: 120,
    apiBaseUrl: 'https://api.example.test/v1',
  });
});

test('getCredits calls credits endpoint', async () => {
  const requests = [];
  const credits = await getCredits(
    {
      apiKey: 'ast_test_123',
      apiBaseUrl: 'https://api.example.test/v1',
    },
    async (url, init) => {
      requests.push({ url, init });
      return jsonResponse({
        success: true,
        data: { balance: 6200, unit: 'seconds' },
      });
    },
  );

  assert.equal(credits.balance, 6200);
  assert.equal(requests[0].url, 'https://api.example.test/v1/credits');
  assert.equal(requests[0].init.headers.Authorization, 'Bearer ast_test_123');
});

test('createSplit posts direct URL body and idempotency key', async () => {
  const requests = [];
  const split = await createSplit(
    {
      apiKey: 'ast_test_123',
      audioUrl: 'https://example.com/song.mp3',
      stemModel: '6s',
      outputFormat: 'mp3',
      wait: false,
      timeoutSeconds: 300,
      apiBaseUrl: 'https://api.example.test/v1',
      idempotencyKey: 'retry-001',
    },
    async (url, init) => {
      requests.push({ url, init });
      return jsonResponse({
        success: true,
        data: {
          id: 'split_123',
          status: 'queued',
          creditsUsed: 214,
          createdAt: '2026-05-03T10:20:30.000Z',
        },
      });
    },
  );

  assert.equal(split.id, 'split_123');
  assert.equal(requests[0].url, 'https://api.example.test/v1/audio/splits');
  assert.equal(requests[0].init.headers.Authorization, 'Bearer ast_test_123');
  assert.equal(requests[0].init.headers['Idempotency-Key'], 'retry-001');
  assert.deepEqual(JSON.parse(requests[0].init.body), {
    input: {
      type: 'direct_url',
      url: 'https://example.com/song.mp3',
    },
    stemModel: '6s',
    outputFormat: 'mp3',
  });
});

test('waitForSplit polls until succeeded', async () => {
  let attempts = 0;
  const split = await waitForSplit(
    {
      apiKey: 'ast_test_123',
      apiBaseUrl: 'https://api.example.test/v1',
      timeoutSeconds: 1,
    },
    'split_123',
    async () => {
      attempts += 1;
      return jsonResponse({
        success: true,
        data: {
          id: 'split_123',
          status: attempts === 1 ? 'processing' : 'succeeded',
          stems: { vocals: 'https://cdn.example.com/vocals.mp3' },
        },
      });
    },
    async () => {},
  );

  assert.equal(attempts, 2);
  assert.equal(split.status, 'succeeded');
  assert.equal(split.stems.vocals, 'https://cdn.example.com/vocals.mp3');
});

test('runAction writes outputs', async () => {
  const outputs = [];
  const logs = [];

  await runAction({
    env: {
      INPUT_API_KEY: 'ast_test_123',
      INPUT_AUDIO_URL: 'https://example.com/song.mp3',
      INPUT_WAIT: 'false',
    },
    fetchImpl: async () =>
      jsonResponse({
        success: true,
        data: {
          id: 'split_123',
          status: 'queued',
          creditsUsed: 214,
          createdAt: '2026-05-03T10:20:30.000Z',
        },
      }),
    setOutput: (name, value) => outputs.push([name, value]),
    info: (message) => logs.push(message),
  });

  assert.deepEqual(outputs, [
    ['split-id', 'split_123'],
    ['status', 'queued'],
    ['result-json', '{"id":"split_123","status":"queued","creditsUsed":214,"createdAt":"2026-05-03T10:20:30.000Z"}'],
  ]);
  assert.equal(logs[0], 'Created AIStemSplitter split split_123');
});

test('runAction supports credits operation', async () => {
  const outputs = [];

  await runAction({
    env: {
      INPUT_API_KEY: 'ast_test_123',
      INPUT_OPERATION: 'credits',
    },
    fetchImpl: async () =>
      jsonResponse({
        success: true,
        data: { balance: 6200, unit: 'seconds' },
      }),
    setOutput: (name, value) => outputs.push([name, value]),
    info: () => {},
  });

  assert.deepEqual(outputs, [
    ['credits-balance', '6200'],
    ['credits-unit', 'seconds'],
    ['result-json', '{"balance":6200,"unit":"seconds"}'],
  ]);
});

test('API errors raise typed errors', async () => {
  await assert.rejects(
    createSplit(
      {
        apiKey: 'ast_test_123',
        audioUrl: 'https://example.com/song.mp3',
        stemModel: '6s',
        wait: false,
        timeoutSeconds: 300,
        apiBaseUrl: 'https://api.aistemsplitter.org/v1',
      },
      async () =>
        jsonResponse(
          {
            success: false,
            error: {
              code: 'UNAUTHORIZED',
              message: 'Missing or invalid API key',
            },
          },
          401,
        ),
    ),
    (error) =>
      error instanceof AIStemSplitterActionError &&
      error.status === 401 &&
      error.code === 'UNAUTHORIZED',
  );
});

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return body;
    },
  };
}
