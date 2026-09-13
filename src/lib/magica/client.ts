import { jsonError } from "@/lib/errors";

export type MagicaRunStatus = "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELED" | string;

export type MagicaRun = {
  id: string;
  nodeType?: string;
  subModelId?: string | null;
  status: MagicaRunStatus;
  input?: unknown;
  output?: unknown;
  error?: string | null;
  userMessage?: string | null;
  creditUsed?: number;
};

function config() {
  const apiKey = process.env.MAGICA_API_KEY;
  const baseUrl = process.env.MAGICA_BASE_URL;
  if (!apiKey) throw jsonError(500, "CONFIG", "MAGICA_API_KEY is not set");
  if (!baseUrl) throw jsonError(500, "CONFIG", "MAGICA_BASE_URL is not set");
  return { apiKey, baseUrl: baseUrl.replace(/\/$/, "") };
}

async function magicaFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { apiKey, baseUrl } = config();
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  if (response.status === 401) {
    throw jsonError(502, "PROVIDER_UNAUTHORIZED", "Magica rejected the request.");
  }
  if (response.status === 429) {
    throw jsonError(429, "PROVIDER_RATE_LIMITED", "Magica is rate limited. Try again shortly.");
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { message?: string; error?: string };
    throw jsonError(
      response.status >= 400 && response.status < 500 ? 400 : 502,
      "PROVIDER_ERROR",
      body.message ?? body.error ?? "Magica request failed",
    );
  }
  return (await response.json()) as T;
}

export async function getModelSchema(modelId: string): Promise<unknown> {
  return magicaFetch(`/v1/models/${encodeURIComponent(modelId)}/schema`);
}

export async function startNodeRun(input: {
  nodeType: string;
  subModelId?: string;
  input: Record<string, unknown>;
}): Promise<{ runId: string }> {
  return magicaFetch(`/v1/nodes/${encodeURIComponent(input.nodeType)}/run`, {
    method: "POST",
    body: JSON.stringify({
      input: input.input,
      ...(input.subModelId ? { subModelId: input.subModelId } : {}),
    }),
  });
}

export async function getNodeRun(runId: string): Promise<MagicaRun> {
  return magicaFetch(`/v1/nodes/runs/${encodeURIComponent(runId)}`);
}

export async function estimateNodeCredits(nodes: unknown[]): Promise<{ total?: number } | null> {
  try {
    return await magicaFetch("/v1/nodes/estimate-credits", {
      method: "POST",
      body: JSON.stringify({ nodes }),
    });
  } catch {
    return null;
  }
}

function asCreditUsed(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

export function readMagicaCreditUsed(run: unknown): number {
  if (!run || typeof run !== "object") return 0;
  const record = run as Record<string, unknown>;
  const top = asCreditUsed(record.creditUsed);
  if (top) return top;
  const output = record.output;
  if (output && typeof output === "object" && !Array.isArray(output)) {
    return asCreditUsed((output as Record<string, unknown>).creditUsed);
  }
  return 0;
}

export function formatMagicaCredits(creditUsed: number | undefined): string {
  const units = asCreditUsed(creditUsed);
  return `${(units / 1_000_000).toFixed(2)}M credits`;
}

export function mapMagicaCredits(creditUsed: number | undefined): number {
  if (!creditUsed || creditUsed <= 0) return 0;
  return Math.round(creditUsed);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function pollNodeRun(
  runId: string,
  options: {
    intervalMs?: number;
    maxAttempts?: number;
    shouldAbort?: () => Promise<boolean>;
  } = {},
): Promise<MagicaRun> {
  const intervalMs = options.intervalMs ?? 2000;
  const maxAttempts = options.maxAttempts ?? 60;
  const terminal = new Set(["COMPLETED", "FAILED", "CANCELED"]);
  let run = await getNodeRun(runId);
  for (let attempt = 0; attempt < maxAttempts && !terminal.has(run.status); attempt += 1) {
    if (options.shouldAbort && (await options.shouldAbort())) {
      throw jsonError(409, "CANCELLED", "Run was stopped");
    }
    await sleep(intervalMs);
    run = await getNodeRun(runId);
  }
  if (!terminal.has(run.status)) {
    throw jsonError(504, "PROVIDER_TIMEOUT", "Magica run timed out");
  }
  return run;
}
