import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Put,
  UploadedFile,
  UseFilters,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBody, ApiConsumes } from '@nestjs/swagger';
import { FileInterceptor, type UploadedMultipartFile } from '@nestjs/platform-fastify/multipart';
import {
  createCvFromPdfFieldsSchema,
  createCvFromTextRequestSchema,
  LIMITS,
  ROUTES,
  updateDocumentRequestSchema,
  type CreateCvFromTextRequest,
  type CreateCvResponse,
  type CvDetail,
  type CvListResponse,
  type UpdateDocumentRequest,
  type UpdateDocumentResponse,
} from '@cv/shared';
import { ApiError } from '../common/api-error.js';
import { CurrentUser, type SessionUser } from '../common/current-user.js';
import { SourcesService } from '../sources/sources.service.js';
import { CvDocumentsService } from './cv-documents.service.js';
import { CvsService } from './cvs.service.js';
import { PdfTooLargeFilter } from './pdf-too-large.filter.js';

@Controller('cvs')
export class CvsController {
  constructor(
    @Inject(CvsService) private readonly cvs: CvsService,
    @Inject(CvDocumentsService) private readonly documents: CvDocumentsService,
    @Inject(SourcesService) private readonly sources: SourcesService,
  ) {}

  @Get()
  async list(@CurrentUser() user: SessionUser): Promise<CvListResponse> {
    return { items: await this.cvs.list(user.id) };
  }

  @HttpCode(ROUTES.createCvFromText.status)
  @Post()
  create(
    @CurrentUser() user: SessionUser,
    @Body({ schema: createCvFromTextRequestSchema }) body: CreateCvFromTextRequest,
  ): Promise<CreateCvResponse> {
    return this.cvs.create(user.id, { ...body, kind: 'text' });
  }

  // The JSON body Swagger derives from `@Body({ schema })` would be wrong for a multipart request.
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file', 'targetRole'],
      properties: {
        file: { type: 'string', format: 'binary', description: 'The CV as a PDF' },
        targetRole: { type: 'string', minLength: 1, maxLength: LIMITS.maxTargetRoleChars },
      },
    },
  })
  @HttpCode(ROUTES.createCvFromPdf.status)
  @UseFilters(PdfTooLargeFilter)
  @UseInterceptors(FileInterceptor('file'))
  @Post('from-pdf')
  async createFromPdf(
    @CurrentUser() user: SessionUser,
    @Body({ schema: createCvFromPdfFieldsSchema }) fields: { targetRole: string },
    @UploadedFile() file: UploadedMultipartFile | undefined,
  ): Promise<CreateCvResponse> {
    if (!file?.buffer) {
      throw new ApiError('VALIDATION_FAILED', 'Attach your CV as a PDF in the "file" field.', [
        { path: 'file', message: 'Required' },
      ]);
    }
    const text = await this.sources.textFromPdf(file.buffer);
    return this.cvs.create(user.id, { targetRole: fields.targetRole, kind: 'pdf', text });
  }

  @Get(':id')
  detail(@CurrentUser() user: SessionUser, @Param('id') id: string): Promise<CvDetail> {
    return this.cvs.detail(id, user.id);
  }

  @Put(':id/document')
  saveDocument(
    @CurrentUser() user: SessionUser,
    @Param('id') id: string,
    @Body({ schema: updateDocumentRequestSchema }) body: UpdateDocumentRequest,
  ): Promise<UpdateDocumentResponse> {
    return this.documents.save(id, user.id, body);
  }

  @HttpCode(ROUTES.deleteCv.status)
  @Delete(':id')
  remove(@CurrentUser() user: SessionUser, @Param('id') id: string): Promise<void> {
    return this.cvs.remove(id, user.id);
  }
}
