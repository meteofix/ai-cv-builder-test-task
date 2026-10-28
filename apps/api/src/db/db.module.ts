import { PostgreSqlDriver } from '@mikro-orm/postgresql';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { Module } from '@nestjs/common';
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
      // Migrations run on every start, so `docker compose up` needs no manual step.
      useFactory: async (config: AppConfig) => {
        await ensureDatabase(config);
        return ormOptions(config);
      },
    }),
  ],
})
export class DbModule {}
