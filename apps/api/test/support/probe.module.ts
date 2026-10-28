import {
  Body,
  Controller,
  Get,
  Inject,
  Ip,
  Module,
  Param,
  Post,
  ServiceUnavailableException,
} from '@nestjs/common';
import { credentialsSchema, type Credentials } from '@cv/shared';
import { ApiError } from '../../src/common/api-error.js';
import { CurrentUser, Public, type SessionUser } from '../../src/common/current-user.js';
import { OwnedCvs } from '../../src/common/owned-cvs.js';

/** Routes that expose what the global wiring hands to a controller; mounted only in tests. */
@Controller('probe')
class ProbeController {
  constructor(@Inject(OwnedCvs) private readonly cvs: OwnedCvs) {}

  @Get('me')
  me(@CurrentUser() user: SessionUser) {
    return user;
  }

  @Post('me')
  postMe(@CurrentUser() user: SessionUser) {
    return user;
  }

  @Public()
  @Get('ip')
  ip(@Ip() ip: string) {
    return { ip };
  }

  @Get('cvs/:id')
  async cv(@Param('id') id: string, @CurrentUser() user: SessionUser) {
    const cv = await this.cvs.findOwned(id, user.id);
    return { id: cv.id };
  }

  @Public()
  @Post('validate')
  validate(@Body({ schema: credentialsSchema }) body: Credentials) {
    return { email: body.email };
  }

  @Public()
  @Get('conflict')
  conflict() {
    throw new ApiError('VERSION_CONFLICT', 'The CV was changed elsewhere.');
  }

  @Public()
  @Get('unavailable')
  unavailable() {
    throw new ServiceUnavailableException('Database is not reachable');
  }

  @Public()
  @Get('crash')
  crash() {
    throw new Error('connection to 10.0.0.7 lost while saving iryna@example.com');
  }
}

@Module({ controllers: [ProbeController] })
export class ProbeModule {}
