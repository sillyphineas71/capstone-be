import { EntityManager } from 'typeorm';
import { UserRoleEntity } from '../entities/user-role.entity.js';

/**
 * Đọc role_code của toàn bộ role active (chưa hết hạn) của 1 user.
 * Cùng điều kiện `is_active` + `expired_at` như `UsersService.updateUserRoles`.
 */
export async function getActiveRoleCodes(
  manager: EntityManager,
  userId: string,
): Promise<string[]> {
  const activeRoles = await manager.find(UserRoleEntity, {
    where: { userId, isActive: true },
    relations: { role: true },
  });

  const now = new Date();
  return activeRoles
    .filter((ur) => !ur.expiredAt || ur.expiredAt > now)
    .map((ur) => ur.role.roleCode);
}
