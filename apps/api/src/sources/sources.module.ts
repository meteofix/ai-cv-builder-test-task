import { Module } from '@nestjs/common';
import { SourcesService } from './sources.service.js';

@Module({ providers: [SourcesService], exports: [SourcesService] })
export class SourcesModule {}
