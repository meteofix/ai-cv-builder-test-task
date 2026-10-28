import { statusError } from '../../src/llm/anthropic-transport.js';
import {
  LlmTransport,
  type LlmRole,
  type TransportRequest,
  type TransportResult,
} from '../../src/llm/llm-transport.js';

/**
 * One scripted answer: model output (validated by the request's schema like the real transport does), an
 * HTTP status, a refusal, or a function that decides per request and may wait (to change the world while
 * the "model" is thinking).
 */
export type FakeAnswer =
  | { output: unknown }
  | { status: number; retryAfter?: string }
  | { refusal: true }
  | ((request: TransportRequest<unknown>, signal: AbortSignal) => Promise<FakeAnswer> | FakeAnswer);

const USAGE = { input: 100, output: 50 };

/**
 * The scripted model of the tests. It replaces only the transport, so the client's retries, re-asks and
 * call budget run for real. Answers are served per role in order; the last one repeats.
 */
export class FakeLlmClient extends LlmTransport {
  readonly requests: TransportRequest<unknown>[] = [];
  private scripts = new Map<LlmRole, FakeAnswer[]>();

  on(role: LlmRole, ...answers: FakeAnswer[]): this {
    this.scripts.set(role, answers);
    return this;
  }

  reset(): void {
    this.requests.length = 0;
    this.scripts = new Map();
  }

  /** The user turns the role received, in order. */
  inputs(role: LlmRole): string[] {
    return this.requests
      .filter((request) => request.role === role)
      .map((request) => request.messages.map((message) => message.content).join('\n'));
  }

  async send<T>(request: TransportRequest<T>, signal: AbortSignal): Promise<TransportResult<T>> {
    this.requests.push(request);
    const queue = this.scripts.get(request.role);
    const next = queue && (queue.length > 1 ? queue.shift() : queue[0]);
    if (!next) throw new Error(`FakeLlmClient: no answer scripted for the ${request.role}`);
    let answer = next;
    while (typeof answer === 'function') {
      answer = await answer(request, signal);
    }
    signal.throwIfAborted();
    if ('status' in answer) throw statusError(answer.status, answer.retryAfter);
    if ('refusal' in answer) return { kind: 'refusal', stopReason: 'refusal', usage: USAGE };
    const parsed = request.schema.safeParse(answer.output);
    if (!parsed.success) {
      return { kind: 'invalid', error: parsed.error.message, stopReason: 'end_turn', usage: USAGE };
    }
    return { kind: 'output', output: parsed.data, stopReason: 'end_turn', usage: USAGE };
  }
}
