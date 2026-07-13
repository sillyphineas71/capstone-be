import { OllamaLlmProvider } from './ollama-llm.provider.js';
import { LlmGenerateOptions } from './llm-provider.port.js';

const OPTS: LlmGenerateOptions = {
  timeoutMs: 5000,
  temperature: 0.2,
  modelName: 'qwen2.5:7b-instruct',
};

describe('OllamaLlmProvider (T017 — mock fetch)', () => {
  let provider: OllamaLlmProvider;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock;
    provider = new OllamaLlmProvider({
      get: jest.fn().mockReturnValue('http://localhost:11434'),
    } as never);
  });

  it('200 hop le -> tra message.content, body request dung contract', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ message: { content: '{"summary":"ok"}' } }),
    });

    const result = await provider.generate('prompt-abc', OPTS);
    expect(result).toBe('{"summary":"ok"}');

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:11434/api/chat');
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.model).toBe('qwen2.5:7b-instruct');
    expect(body.format).toBe('json');
    expect(body.stream).toBe(false);
    expect(body.options).toEqual({ temperature: 0.2, num_ctx: 4100 }); // ceil(10/3)+4096=4100
    expect(body.messages).toEqual([{ role: 'user', content: 'prompt-abc' }]);
    expect(init.signal).toBeDefined(); // AbortSignal timeout được gắn
  });

  it('prompt dai -> num_ctx tinh theo do dai prompt (khong dung default Ollama)', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ message: { content: '{"summary":"ok"}' } }),
    });

    const longPrompt = 'a'.repeat(60000); // ~20000 token uoc tinh (chars/3)
    await provider.generate(longPrompt, OPTS);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    // estimatedPromptTokens = ceil(60000/3) = 20000; +4096 reserve = 24096
    expect(body.options).toEqual({ temperature: 0.2, num_ctx: 24096 });
  });

  it('prompt vuot max context -> num_ctx clamp ve 32768', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ message: { content: '{"summary":"ok"}' } }),
    });

    const hugePrompt = 'a'.repeat(200000); // ~66667 token uoc tinh, vuot max
    await provider.generate(hugePrompt, OPTS);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect((body.options as { num_ctx: number }).num_ctx).toBe(32768);
  });

  it('timeout (TimeoutError) -> throw error retryable, khong nuot loi', async () => {
    const timeoutErr = new Error('The operation was aborted due to timeout');
    timeoutErr.name = 'TimeoutError';
    fetchMock.mockRejectedValue(timeoutErr);

    await expect(provider.generate('p', OPTS)).rejects.toThrow(
      'Ollama khong phan hoi (TimeoutError)',
    );
  });

  it('network error -> throw error retryable', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    await expect(provider.generate('p', OPTS)).rejects.toThrow(
      'Ollama khong phan hoi',
    );
  });

  it('HTTP 500 -> throw error co status', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500 });
    await expect(provider.generate('p', OPTS)).rejects.toThrow(
      'Ollama tra HTTP 500',
    );
  });

  it('response thieu message.content -> throw', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ message: {} }),
    });
    await expect(provider.generate('p', OPTS)).rejects.toThrow(
      'khong co message.content',
    );
  });
});
