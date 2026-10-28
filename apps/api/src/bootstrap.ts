import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { StandardSchemaValidationPipe, type DynamicModule, type Type } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { Logger } from 'pino';
import { AppModule } from './app.module.js';
import type { AppConfig } from './config/env.js';
import { NestPinoLogger } from './config/logger.js';
import { trustProxyAddresses } from './config/trust-proxy.js';

export interface CreateAppOptions {
  /** Extra modules mounted next to the app's own; tests use it for probe controllers. */
  imports?: (Type | DynamicModule)[];
}

/**
 * Builds the application with every global mechanism. `main.ts` and the e2e tests both call it,
 * so tests exercise the same wiring as production. The caller listens or injects requests.
 */
export async function createApp(
  config: AppConfig,
  logger: Logger,
  options: CreateAppOptions = {},
): Promise<NestFastifyApplication> {
  const adapter = new FastifyAdapter({
    loggerInstance: logger,
    // nginx sets X-Request-Id; direct calls get a fresh id. Either way it becomes `reqId` in every log line.
    requestIdHeader: false,
    genReqId: (request: IncomingMessage) => {
      const sent = request.headers['x-request-id'];
      return typeof sent === 'string' && /^[\w.-]{1,128}$/.test(sent) ? sent : randomUUID();
    },
    // Client address comes from X-Forwarded-For of the trusted proxy; otherwise the throttler sees one IP.
    trustProxy: trustProxyAddresses(config.TRUST_PROXY),
    multipart: { limits: { fileSize: config.MAX_UPLOAD_BYTES, files: 1 } },
  });

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule.forRoot(config, logger, options.imports),
    adapter,
    // Without abortOnError Nest calls process.abort() on a startup failure and hides the reason.
    { logger: new NestPinoLogger(logger), abortOnError: false },
  );

  app.setGlobalPrefix('api');
  // `upgrade-insecure-requests` would make a browser on http://<lan-ip> request the API's assets over https.
  app.useSecurityHeaders(
    config.COOKIE_SECURE
      ? {}
      : { contentSecurityPolicy: { directives: { upgradeInsecureRequests: null } } },
  );
  app.enableCsrfProtection();
  app.useGlobalPipes(new StandardSchemaValidationPipe());

  adapter.getInstance().addHook('onSend', (request, reply, _payload, done) => {
    void reply.header('x-request-id', request.id);
    done();
  });

  const openApi = SwaggerModule.createDocument(
    app,
    new DocumentBuilder().setTitle('AI CV Builder API').setVersion('1').build(),
  );
  SwaggerModule.setup('api/docs', app, openApi);

  return app;
}
