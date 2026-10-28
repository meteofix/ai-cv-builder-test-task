import { MikroORM } from '@mikro-orm/postgresql';
import { Controller, Get, Inject, Logger, ServiceUnavailableException } from '@nestjs/common';

@Controller('health')
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(@Inject(MikroORM) private readonly orm: MikroORM) {}

  /** The process is up; says nothing about dependencies. */
  @Get('live')
  live() {
    return { status: 'ok' };
  }

  /** The database answers; the compose healthcheck and load balancers use this. */
  @Get('ready')
  async ready() {
    try {
      await this.orm.em.getConnection().execute('select 1');
    } catch (error) {
      this.logger.warn(
        `Database check failed: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
      throw new ServiceUnavailableException('Database is not reachable');
    }
    return { status: 'ok' };
  }
}
