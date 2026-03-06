import endpointConfig from "../../../config/runpod_endpoints.json";

const RUNPOD_BASE_URL = "https://api.runpod.ai/v2";
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;
const BACKOFF_FACTOR = 1.5;
const MAX_POLL_MULTIPLIER = 5;

interface RunPodOutput {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

interface RunPodJobResponse {
  id: string;
  status: "IN_QUEUE" | "IN_PROGRESS" | "COMPLETED" | "FAILED" | "CANCELLED";
  output?: RunPodOutput;
  error?: string;
}

interface RunPodRunSyncResponse {
  id: string;
  status: string;
  output?: RunPodOutput;
  error?: string;
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pollJob(
  endpointId: string,
  jobId: string,
  apiKey: string,
  attempt = 0
): Promise<RunPodOutput> {
  const response = await fetch(
    `${RUNPOD_BASE_URL}/${endpointId}/status/${jobId}`,
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
    }
  );

  if (!response.ok) {
    throw new Error(`RunPod status check failed: ${response.statusText}`);
  }

  const data: RunPodJobResponse = await response.json();

  if (data.status === "COMPLETED") {
    return data.output ?? {};
  }

  if (data.status === "FAILED" || data.status === "CANCELLED") {
    throw new Error(
      `RunPod job ${data.status.toLowerCase()}: ${data.error ?? "unknown error"}`
    );
  }

  if (attempt >= MAX_RETRIES * MAX_POLL_MULTIPLIER) {
    throw new Error("RunPod job timed out waiting for completion");
  }

  await sleep(BASE_DELAY_MS * Math.pow(BACKOFF_FACTOR, attempt));
  return pollJob(endpointId, jobId, apiKey, attempt + 1);
}

export async function runPodRunSync(
  endpointId: string,
  input: RunPodOutput,
  apiKey: string
): Promise<RunPodOutput> {
  const response = await fetch(`${RUNPOD_BASE_URL}/${endpointId}/runsync`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ input }),
  });

  if (!response.ok) {
    throw new Error(`RunPod runsync request failed: ${response.statusText}`);
  }

  const data: RunPodRunSyncResponse = await response.json();

  if (data.status === "COMPLETED") {
    return data.output ?? {};
  }

  if (data.status === "FAILED") {
    throw new Error(`RunPod job failed: ${data.error ?? "unknown error"}`);
  }

  // Job is still in queue/progress — poll for result
  return pollJob(endpointId, data.id, apiKey);
}

export class RunPodEndpoints {
  private readonly apiKey: string;
  private readonly jaisEndpointId: string;
  private readonly falconH1EndpointId: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
    this.jaisEndpointId = endpointConfig.jais.endpointId;
    this.falconH1EndpointId = endpointConfig.falconH1.endpointId;
  }

  /**
   * Validate Arabic text using the Jais serverless endpoint.
   * @param text - The Arabic text to validate.
   * @returns The endpoint output containing validation results.
   */
  async validateArabic(text: string): Promise<RunPodOutput> {
    return runPodRunSync(
      this.jaisEndpointId,
      { text },
      this.apiKey
    );
  }

  /**
   * Rate/curate content using the Falcon H1 serverless endpoint.
   * @param content - The content to rate.
   * @returns The endpoint output containing rating/curation results.
   */
  async rateContent(content: string): Promise<RunPodOutput> {
    return runPodRunSync(
      this.falconH1EndpointId,
      { content },
      this.apiKey
    );
  }
}
