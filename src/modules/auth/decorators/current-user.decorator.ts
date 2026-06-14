import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export const CurrentUser = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): { userId: string } | undefined => {
    const request = ctx.switchToHttp().getRequest();
    return request['user'] as { userId: string } | undefined;
  },
);
