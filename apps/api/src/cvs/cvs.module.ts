import { Module } from '@nestjs/common';
import { SourcesModule } from '../sources/sources.module.js';
import { CvDocumentsService } from './cv-documents.service.js';
import { CvsController } from './cvs.controller.js';
import { CvsService } from './cvs.service.js';

@Module({
  imports: [SourcesModule],
  controllers: [CvsController],
  providers: [CvsService, CvDocumentsService],
})
export class CvsModule {}
