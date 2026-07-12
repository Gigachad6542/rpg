export type LoreRegexTest = (
  source: string,
  flags: string,
  text: string,
  timeoutMs: number,
) => Promise<boolean>;

export const testRegexInWorker: LoreRegexTest = (source, flags, text, timeoutMs) => {
  if (typeof Worker === "undefined") {
    return Promise.reject(new Error("Regex worker is unavailable."));
  }

  return new Promise<boolean>((resolve, reject) => {
    const worker = new Worker(new URL("./loreRegexWorker.ts", import.meta.url), { type: "module" });
    const timer = globalThis.setTimeout(() => {
      worker.terminate();
      reject(new Error("Regex worker timed out."));
    }, timeoutMs);
    const finish = (callback: () => void) => {
      globalThis.clearTimeout(timer);
      worker.terminate();
      callback();
    };

    worker.onmessage = (event: MessageEvent<{ matched?: boolean; error?: string }>) => {
      if (event.data.error) {
        finish(() => reject(new Error(event.data.error)));
        return;
      }
      finish(() => resolve(event.data.matched === true));
    };
    worker.onerror = () => finish(() => reject(new Error("Regex worker failed.")));
    worker.postMessage({ source, flags, text });
  });
};

