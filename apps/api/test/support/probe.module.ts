import { Controller, Get, Inject, Ip, Module, Param, Post } from '@nestjs/common';
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
}

@Module({ controllers: [ProbeController] })
export class ProbeModule {}
