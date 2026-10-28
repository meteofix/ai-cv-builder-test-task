import { Body, Controller, HttpCode, Inject, Param, Post } from '@nestjs/common';
import {
  answerQuestionRequestSchema,
  ROUTES,
  type AnswerQuestionRequest,
  type Job,
  type Question,
} from '@cv/shared';
import { CurrentUser, type SessionUser } from '../common/current-user.js';
import { QuestionsService } from './questions.service.js';

@Controller('cvs/:id/questions/:qid')
export class QuestionsController {
  constructor(@Inject(QuestionsService) private readonly questions: QuestionsService) {}

  @HttpCode(ROUTES.answerQuestion.status)
  @Post('answer')
  answer(
    @CurrentUser() user: SessionUser,
    @Param('id') id: string,
    @Param('qid') qid: string,
    @Body({ schema: answerQuestionRequestSchema }) body: AnswerQuestionRequest,
  ): Promise<{ question: Question; job: Job }> {
    return this.questions.answer(id, qid, user.id, body);
  }

  @HttpCode(ROUTES.dismissQuestion.status)
  @Post('dismiss')
  async dismiss(
    @CurrentUser() user: SessionUser,
    @Param('id') id: string,
    @Param('qid') qid: string,
  ): Promise<{ question: Question }> {
    return { question: await this.questions.dismiss(id, qid, user.id) };
  }
}
