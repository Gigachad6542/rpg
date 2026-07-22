export type ResponseReadRunner = <T>(operation: Promise<T>) => Promise<T>;

export interface BoundedResponseReadOptions {
  maxBytes: number;
  label: string;
  run?: ResponseReadRunner;
}

const immediateRunner: ResponseReadRunner = async <T>(operation: Promise<T>) => operation;

export function assertBoundedResponseContentLength(
  response: Response,
  maxBytes: number,
  label: string,
): void {
  const rawLength = response.headers?.get("content-length");
  if (!rawLength) return;
  const contentLength = Number(rawLength);
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new Error(`${label} exceeds the ${String(maxBytes)} byte safety limit.`);
  }
}

export async function readBoundedResponseText(
  response: Response,
  options: BoundedResponseReadOptions,
): Promise<string> {
  const run = options.run ?? immediateRunner;
  assertBoundedResponseContentLength(response, options.maxBytes, options.label);

  if (!response.body) {
    throw new Error(`${options.label} did not expose a readable response stream.`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let byteLength = 0;
  let text = "";
  while (true) {
    const { done, value } = await run(reader.read());
    if (done) break;
    byteLength += value.byteLength;
    if (byteLength > options.maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new Error(`${options.label} exceeds the ${String(options.maxBytes)} byte safety limit.`);
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

export async function readBoundedResponseJson<T>(
  response: Response,
  options: BoundedResponseReadOptions,
): Promise<T> {
  return JSON.parse(await readBoundedResponseText(response, options)) as T;
}
