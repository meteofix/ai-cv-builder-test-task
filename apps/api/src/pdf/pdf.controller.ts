import { Controller, Get, Header, Inject, Param, Res, StreamableFile } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { CurrentUser, type SessionUser } from '../common/current-user.js';
import { attachmentHeader } from './content-disposition.js';
import { PdfService } from './pdf.service.js';

@Controller('cvs/:id/pdf')
export class PdfController {
  constructor(@Inject(PdfService) private readonly pdf: PdfService) {}

  @Header('Cache-Control', 'no-store')
  @Get()
  async download(
    @CurrentUser() user: SessionUser,
    @Param('id') id: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<StreamableFile> {
    const { bytes, fullName } = await this.pdf.forCv(id, user.id);
    void reply.header('Content-Disposition', attachmentHeader(fullName));
    return new StreamableFile(bytes, { type: 'application/pdf', length: bytes.length });
  }
}
