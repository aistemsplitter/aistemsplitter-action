import { appendFileSync } from 'node:fs';

const DEFAULT_API_BASE_URL = 'https://api.aistemsplitter.org/v1';

export class AIStemSplitterActionError extends Error {
  constructor(message, status, code) {
    super(message);
    this.name = 'AIStemSplitterActionError';
    this.status = status;
    this.code = code;
  }
}

export function getInputs(env = process.env) {
  const apiKey = requiredInput(env, 'API_KEY');
  const operation = input(env, 'OPERATION') || 'create-split';
  const audioUrl = operation === 'credits' ? '' : requiredInput(env, 'AUDIO_URL');
  const stemModel = input(env, 'STEM_MODEL') || '6s';
  const outputFormat = input(env, 'OUTPUT_FORMAT') || 'mp3';
  const wait = parseBoolean(input(env, 'WAIT') || 'false');
  const timeoutSeconds = Number(input(env, 'TIMEOUT_SECONDS') || '300');
  const apiBaseUrl = (input(env, 'API_BASE_URL') || DEFAULT_API_BASE_URL)
    .replace(/\/+$/, '');
  const idempotencyKey = input(env, 'IDEMPOTENCY_KEY');

  return {
    apiKey,
    operation,
    audioUrl,
    stemModel,
    outputFormat,
    wait,
    timeoutSeconds,
    apiBaseUrl,
    ...(idempotencyKey ? { idempotencyKey } : {}),
  };
}

export async function getCredits(inputs, fetchImpl = globalThis.fetch) {
  return parseApiResponse(
    await fetchImpl(`${inputs.apiBaseUrl}/credits`, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${inputs.apiKey}`,
      },
    }),
  );
}

export async function createSplit(inputs, fetchImpl = globalThis.fetch) {
  const headers = {
    Accept: 'application/json',
    Authorization: `Bearer ${inputs.apiKey}`,
    'Content-Type': 'application/json',
  };
  if (inputs.idempotencyKey) {
    headers['Idempotency-Key'] = inputs.idempotencyKey;
  }

  return parseApiResponse(
    await fetchImpl(`${inputs.apiBaseUrl}/audio/splits`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        input: {
          type: 'direct_url',
          url: inputs.audioUrl,
        },
        stemModel: inputs.stemModel,
        outputFormat: inputs.outputFormat,
      }),
    }),
  );
}

export async function getSplit(inputs, splitId, fetchImpl = globalThis.fetch) {
  return parseApiResponse(
    await fetchImpl(
      `${inputs.apiBaseUrl}/audio/splits/${encodeURIComponent(splitId)}`,
      {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${inputs.apiKey}`,
        },
      },
    ),
  );
}

export async function waitForSplit(
  inputs,
  splitId,
  fetchImpl = globalThis.fetch,
  sleep = defaultSleep,
) {
  const deadline = Date.now() + inputs.timeoutSeconds * 1000;

  while (true) {
    const split = await getSplit(inputs, splitId, fetchImpl);
    if (split.status === 'succeeded' || split.status === 'failed') {
      return split;
    }

    if (Date.now() >= deadline) {
      throw new AIStemSplitterActionError(
        `Timed out waiting for split ${splitId}`,
        0,
        'TIMEOUT',
      );
    }

    await sleep(Math.min(2000, Math.max(0, deadline - Date.now())));
  }
}

export async function runAction({
  env = process.env,
  fetchImpl = globalThis.fetch,
  setOutput = defaultSetOutput,
  info = console.log,
  sleep = defaultSleep,
} = {}) {
  const inputs = getInputs(env);
  if (inputs.operation === 'credits') {
    const credits = await getCredits(inputs, fetchImpl);
    setOutput('credits-balance', String(credits.balance));
    setOutput('credits-unit', credits.unit);
    setOutput('result-json', JSON.stringify(credits));
    return;
  }

  const created = await createSplit(inputs, fetchImpl);
  info(`Created AIStemSplitter split ${created.id}`);

  const result = inputs.wait
    ? await waitForSplit(inputs, created.id, fetchImpl, sleep)
    : created;

  setOutput('split-id', result.id);
  setOutput('status', result.status);
  setOutput('result-json', JSON.stringify(result));
}

async function parseApiResponse(response) {
  const payload = await response.json().catch(() => ({}));
  if (response.ok && payload.success === true && 'data' in payload) {
    return payload.data;
  }

  if (payload.success === false && payload.error) {
    throw new AIStemSplitterActionError(
      payload.error.message,
      response.status,
      payload.error.code,
    );
  }

  throw new AIStemSplitterActionError(
    `AIStemSplitter API request failed with status ${response.status}`,
    response.status,
    'HTTP_ERROR',
  );
}

function input(env, name) {
  return env[`INPUT_${name}`]?.trim();
}

function requiredInput(env, name) {
  const value = input(env, name);
  if (!value) {
    throw new AIStemSplitterActionError(
      `Missing required input ${name.toLowerCase().replaceAll('_', '-')}`,
      0,
      'CONFIG_ERROR',
    );
  }
  return value;
}

function parseBoolean(value) {
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

function defaultSleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function defaultSetOutput(name, value) {
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
    return;
  }
  console.log(`${name}=${value}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runAction().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
