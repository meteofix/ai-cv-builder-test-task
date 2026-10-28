import { Module } from '@nestjs/common';
import { SourcesModule } from '../sources/sources.module.js';
import { CvDocumentsService } from './cv-documents.service.js';
import { CvsController } from './cvs.controller.js';
import { QuestionsController } from './questions.controller.js';
import { QuestionsService } from './questions.service.js';
import { CvsService } from './cvs.service.js';

@Module({
  imports: [SourcesModule],
  controllers: [CvsController, QuestionsController],
  providers: [CvsService, CvDocumentsService, QuestionsService],
})
export class CvsModule {}
