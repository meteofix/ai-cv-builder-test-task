import { Module } from '@nestjs/common';
import { embeddedFontsProvider } from './embedded-fonts.js';
import { PdfController } from './pdf.controller.js';
import { PdfRenderer } from './pdf-renderer.service.js';
import { PdfService } from './pdf.service.js';

@Module({
  controllers: [PdfController],
  providers: [embeddedFontsProvider, PdfRenderer, PdfService],
})
export class PdfModule {}
