import { z } from 'zod';
import { ServiceError } from '../stt/stt-client.js';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  messages: ChatMessage[];
  thinking: boolean;
  jsonSchema?: Record<string, unknown>;
  maxTokens?: number;
}

export interface ChatResponse {
  content: string;
  /** `stop`, or `length` when max_tokens cut the answer. */
  finishReason: string | null;
  promptTokens: number | null;
  completionTokens: number | null;
}

export interface LlmClient {
  readonly model: string;
  chat(req: ChatRequest): Promise<ChatResponse>;
}

const CompletionSchema = z.object({
  choices: z
    .array(z.object({ message: z.object({ content: z.string().nullable() }), finish_reason: z.string().nullish() }))
    .min(1),
  usage: z.object({ prompt_tokens: z.number().nullish(), completion_tokens: z.number().nullish() }).nullish(),
});

/** OpenAI-compatible chat completions (sglang serving DeepSeek V4 Flash). The key never leaves this class. */
export class HttpLlmClient implements LlmClient {
  constructor(
    private readonly baseUrl: string,
    readonly model: string,
    private readonly apiKey: string,
    private readonly timeoutMs: number,
  ) {}

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const body = {
      model: this.model,
      messages: req.messages,
      temperature: 0.2,
      // thinking spends completion tokens on reasoning before the JSON
      max_tokens: req.maxTokens ?? (req.thinking ? 12_000 : 4000),
      chat_template_kwargs: { thinking: req.thinking },
      separate_reasoning: true,
      ...(req.jsonSchema
        ? {
            response_format: {
              type: 'json_schema',
              json_schema: { name: 'call_analysis', schema: req.jsonSchema, strict: true },
            },
          }
        : {}),
    };
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      throw new ServiceError('llm', `request failed (${(err as Error).name})`, true);
    }
    if (!res.ok)
      throw new ServiceError('llm', `HTTP ${res.status}`, res.status >= 500 || res.status === 429, res.status);
    const parsed = CompletionSchema.safeParse(await res.json());
    if (!parsed.success) throw new ServiceError('llm', 'unexpected response shape', true);
    return {
      content: parsed.data.choices[0].message.content ?? '',
      finishReason: parsed.data.choices[0].finish_reason ?? null,
      promptTokens: parsed.data.usage?.prompt_tokens ?? null,
      completionTokens: parsed.data.usage?.completion_tokens ?? null,
    };
  }
}
