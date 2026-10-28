import { MikroORM, PostgreSqlDriver } from '@mikro-orm/postgresql';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { Inject, Module, type OnModuleInit } from '@nestjs/common';
import { APP_CONFIG } from '../config/tokens.js';
import type { AppConfig } from '../config/env.js';
import { ensureDatabase } from './ensure-database.js';
import { ormOptions } from './orm-options.js';

@Module({
  imports: [
    MikroOrmModule.forRootAsync({
      // Required with useFactory so the module registers the driver-specific MikroORM and EntityManager.
      driver: PostgreSqlDriver,
      inject: [APP_CONFIG],
      useFactory: async (config: AppConfig) => {
        await ensureDatabase(config);
        return ormOptions(config);
      },
    }),
  ],
})
export class DbModule implements OnModuleInit {
  constructor(@Inject(MikroORM) private readonly orm: MikroORM) {}

  /** Applies pending migrations on every start, so `docker compose up` needs no manual step. */
  async onModuleInit(): Promise<void> {
    await this.orm.migrator.up();
  }
}
