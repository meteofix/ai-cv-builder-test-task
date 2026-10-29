import { once } from 'node:events';
import { createServer, type IncomingHttpHeaders } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';

/** An answer of the server; `hang` never answers, `drop` closes the connection without an answer. */
export type Reply =
  { status: number; headers?: Record<string, string>; body: unknown } | 'hang' | 'drop';

export interface RecordedRequest {
  path: string;
  headers: IncomingHttpHeaders;
  body: Record<string, unknown>;
}

/** A Messages API answer whose text is `output` as JSON (or `text` as is). */
export function answer(
  output: unknown,
  options: { stopReason?: string; text?: string } = {},
): Reply {
  return {
    status: 200,
    body: {
      id: 'msg_test',
      type: 'message',
      role: 'assistant',
      model: 'claude-test',
      content: [{ type: 'text', text: options.text ?? JSON.stringify(output) }],
      stop_reason: options.stopReason ?? 'end_turn',
      stop_sequence: null,
      usage: {
        input_tokens: 12,
        output_tokens: 7,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
      },
    },
  };
}

/** A Messages API answer that calls the answer tool with `input` (the `tool` output mode). */
export function toolCall(input: unknown, name = 'answer', stopReason = 'tool_use'): Reply {
  return {
    status: 200,
    body: {
      id: 'msg_test',
      type: 'message',
      role: 'assistant',
      model: 'claude-test',
      content: [{ type: 'tool_use', id: 'toolu_test', name, input }],
      stop_reason: stopReason,
      stop_sequence: null,
      usage: {
        input_tokens: 12,
        output_tokens: 7,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
      },
    },
  };
}

export function failure(status: number, headers: Record<string, string> = {}): Reply {
  return {
    status,
    headers,
    body: { type: 'error', error: { type: 'api_error', message: `status ${status}` } },
  };
}

/**
 * A local HTTP server in place of the Anthropic API, for the real SDK client. Replies are served in
 * order; the last one repeats.
 */
export async function fakeAnthropic() {
  const requests: RecordedRequest[] = [];
  const sockets = new Set<Socket>();
  let replies: Reply[] = [answer({})];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      requests.push({
        path: req.url ?? '',
        headers: req.headers,
        body: JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>,
      });
      const reply = (replies.length > 1 ? replies.shift() : replies[0]) ?? answer({});
      if (reply === 'hang') return;
      if (reply === 'drop') {
        req.socket.destroy();
        return;
      }
      res.writeHead(reply.status, { 'content-type': 'application/json', ...reply.headers });
      res.end(JSON.stringify(reply.body));
    });
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    reply(...next: Reply[]) {
      replies = next;
      requests.length = 0;
    },
    async close() {
      for (const socket of sockets) socket.destroy();
      server.close();
      await once(server, 'close');
    },
  };
}
