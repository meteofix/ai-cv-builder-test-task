import type { LoggerService } from '@nestjs/common';
import { pino, type Logger } from 'pino';
import type { AppConfig } from './env.js';

/** JSON logs. Request and response serializers keep method, url and status only: no headers, cookies or bodies. */
export function createLogger(config: Pick<AppConfig, 'LOG_LEVEL'>): Logger {
  return pino({
    level: config.LOG_LEVEL,
    timestamp: pino.stdTimeFunctions.isoTime,
    serializers: {
      req: (req: { method?: string; url?: string }) => ({ method: req.method, url: req.url }),
      res: (res: { statusCode?: number }) => ({ statusCode: res.statusCode }),
    },
  });
}

/** Routes Nest's own log calls (startup, module errors) through pino. */
export class NestPinoLogger implements LoggerService {
  constructor(private readonly logger: Logger) {}

  log(message: unknown, ...rest: unknown[]) {
    this.logger.info({ context: contextOf(rest) }, text(message));
  }
  error(message: unknown, ...rest: unknown[]) {
    // Nest passes the stack as the second argument when it reports a caught exception.
    const stack = typeof rest[0] === 'string' && rest.length > 1 ? rest[0] : undefined;
    this.logger.error({ context: contextOf(rest), stack }, text(message));
  }
  warn(message: unknown, ...rest: unknown[]) {
    this.logger.warn({ context: contextOf(rest) }, text(message));
  }
  debug(message: unknown, ...rest: unknown[]) {
    this.logger.debug({ context: contextOf(rest) }, text(message));
  }
  verbose(message: unknown, ...rest: unknown[]) {
    this.logger.trace({ context: contextOf(rest) }, text(message));
  }
  fatal(message: unknown, ...rest: unknown[]) {
    this.logger.fatal({ context: contextOf(rest) }, text(message));
  }
}

function contextOf(rest: unknown[]): string | undefined {
  const last = rest.at(-1);
  return typeof last === 'string' ? last : undefined;
}

function text(message: unknown): string {
  if (typeof message === 'string') return message;
  return message instanceof Error ? message.message : JSON.stringify(message);
}
