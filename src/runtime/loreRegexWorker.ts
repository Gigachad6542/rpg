interface RegexWorkerRequest {
  source: string;
  flags: string;
  text: string;
}

self.onmessage = (event: MessageEvent<RegexWorkerRequest>) => {
  try {
    const pattern = new RegExp(event.data.source, event.data.flags);
    self.postMessage({ matched: pattern.test(event.data.text) });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : "Invalid regex." });
  }
};

export {};

