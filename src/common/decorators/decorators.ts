import { SetMetadata, createParamDecorator, ExecutionContext } from '@nestjs/common';
import { UserRole, SubscriptionPlan } from '../../modules/users/entities/user.entity';

export const Roles = (...roles: UserRole[]) => SetMetadata('roles', roles);

export const RequireSubscription = (plan: SubscriptionPlan) => SetMetadata('subscription', plan);

export const CurrentUser = createParamDecorator(
  (data: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    return request.user;
  },
);