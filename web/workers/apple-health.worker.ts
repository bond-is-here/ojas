import { parseAppleHealth } from '../lib/apple-health';
self.onmessage = async (event: MessageEvent<{ file: File; today: string }>) => {
  try {
    const { file, today } = event.data;
    let loaded = 0;
    let lastProgress = 0;
    async function* chunks() {
      const reader = file.stream().getReader();
      const decoder = new TextDecoder();
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          loaded += value.byteLength;
          if (performance.now() - lastProgress > 150) {
            lastProgress = performance.now();
            self.postMessage({
              kind: 'progress',
              percent: Math.round((loaded / file.size) * 100),
            });
          }
          yield decoder.decode(value, { stream: true });
        }
        yield decoder.decode();
      } finally {
        reader.releaseLock();
      }
    }
    const data = await parseAppleHealth(chunks(), today);
    self.postMessage({ kind: 'complete', data });
  } catch (error) {
    self.postMessage({
      kind: 'error',
      message:
        error instanceof Error
          ? error.message
          : 'The export could not be read.',
    });
  }
};
