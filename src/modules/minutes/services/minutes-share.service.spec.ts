/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument */
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';

import { MinutesService } from './minutes.service.js';
import { AuditLogsService } from '../../administration/services/audit-logs.service.js';
import { AuthzReadRepository } from '../../auth/repositories/authz-read.repository.js';
import { StorageService } from '../../storage/storage.service.js';
import { ConfigService } from '@nestjs/config';
import {
  MeetingEntity,
} from '../../meetings/entities/meeting.entity.js';
import {
  MeetingMinutesEntity,
  MeetingMinutesStatus,
} from '../entities/meeting-minutes.entity.js';
import { MeetingMinutesShareEntity } from '../entities/meeting-minutes-share.entity.js';
import { UserEntity, AccountStatus } from '../../accounts/entities/user.entity.js';

describe('MinutesService — share/unshare/list + canAccessMinutes', () => {
  const minutesId = 'minutes-1';
  const meetingId = 'meeting-1';
  const hostId = 'host-1';
  const preparedBy = 'preparer-1';

  // Mutable fixtures per test
  let minutesRow: Partial<MeetingMinutesEntity> | null;
  let meetingRow: Partial<MeetingEntity> | null;
  let targetUserRow: Partial<UserEntity> | null;
  let roles: string[];
  let shareRows: Array<Partial<MeetingMinutesShareEntity>>;
  let saveThrows: unknown | null;

  let service: MinutesService;
  let auditLog: jest.Mock;

  function makeShareRepo() {
    return {
      findOne: jest.fn(),
      count: jest.fn().mockImplementation(({ where }: any) =>
        Promise.resolve(
          shareRows.filter(
            (s) => s.minutesId === where.minutesId && s.userId === where.userId,
          ).length,
        ),
      ),
      create: jest.fn().mockImplementation((data: any) => ({ ...data })),
      save: jest.fn().mockImplementation((data: any) => {
        if (saveThrows) return Promise.reject(saveThrows);
        const row = { id: 'share-new', grantedAt: new Date('2026-07-17T00:00:00Z'), ...data };
        shareRows.push(row);
        return Promise.resolve(row);
      }),
      delete: jest.fn().mockImplementation((crit: any) => {
        const before = shareRows.length;
        shareRows = shareRows.filter(
          (s) => !(s.minutesId === crit.minutesId && s.userId === crit.userId),
        );
        return Promise.resolve({ affected: before - shareRows.length });
      }),
      createQueryBuilder: jest.fn().mockReturnValue({
        leftJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getRawAndEntities: jest.fn().mockImplementation(() => {
          const entities = shareRows.map((s) => ({
            id: s.id,
            userId: s.userId,
            grantedBy: s.grantedBy,
            grantedAt: s.grantedAt,
          }));
          const raw = shareRows.map(() => ({
            targetUser_full_name: 'Target User',
            targetUser_email: 'target@corp.local',
            granter_full_name: 'Host User',
          }));
          return Promise.resolve({ entities, raw });
        }),
      }),
    };
  }

  let shareRepo: ReturnType<typeof makeShareRepo>;

  beforeEach(() => {
    minutesRow = {
      id: minutesId,
      meetingId,
      preparedBy,
      status: MeetingMinutesStatus.PUBLISHED,
      deletedAt: null,
    };
    meetingRow = { id: meetingId, hostId };
    targetUserRow = {
      id: 'target-1',
      fullName: 'Target User',
      email: 'target@corp.local',
      accountStatus: AccountStatus.ACTIVE,
      deletedAt: null,
    };
    roles = []; // not admin by default
    shareRows = [];
    saveThrows = null;
    shareRepo = makeShareRepo();

    auditLog = jest.fn().mockResolvedValue(undefined);

    const dataSource = {
      getRepository: jest.fn().mockImplementation((entity: any) => {
        if (entity === MeetingMinutesEntity) {
          return { findOne: jest.fn().mockImplementation(() => Promise.resolve(minutesRow)) };
        }
        if (entity === MeetingEntity) {
          return { findOne: jest.fn().mockImplementation(() => Promise.resolve(meetingRow)) };
        }
        if (entity === UserEntity) {
          return { findOne: jest.fn().mockImplementation(() => Promise.resolve(targetUserRow)) };
        }
        if (entity === MeetingMinutesShareEntity) {
          return shareRepo;
        }
        return { findOne: jest.fn().mockResolvedValue(null) };
      }),
    } as unknown as DataSource;

    const auditLogsService = {
      logAction: auditLog,
    } as unknown as AuditLogsService;

    const authzRepo = {
      getEffectiveRolesAndPermissions: jest
        .fn()
        .mockImplementation(() => Promise.resolve({ roles, permissions: [] })),
    } as unknown as AuthzReadRepository;

    service = new MinutesService(
      dataSource,
      auditLogsService,
      authzRepo,
      {} as unknown as StorageService,
      {} as unknown as ConfigService,
      {} as any,
    );
  });

  // ---------- canAccessMinutes (security-critical, T013) ----------

  const callAccess = (
    minutes: Partial<MeetingMinutesEntity>,
    meeting: Partial<MeetingEntity>,
    userId: string,
    isAdmin: boolean,
    isParticipant: boolean,
  ): Promise<boolean> =>
    (service as any).canAccessMinutes(minutes, meeting, userId, isAdmin, isParticipant);

  it('[T013] shared user CAN view a published minutes even if not participant/host', async () => {
    shareRows = [{ minutesId, userId: 'target-1' }];
    const ok = await callAccess(
      { id: minutesId, status: MeetingMinutesStatus.PUBLISHED, preparedBy },
      { id: meetingId, hostId },
      'target-1',
      false,
      false,
    );
    expect(ok).toBe(true);
  });

  it('[T013] shared user still CAN view after minutes becomes archived', async () => {
    shareRows = [{ minutesId, userId: 'target-1' }];
    const ok = await callAccess(
      { id: minutesId, status: MeetingMinutesStatus.ARCHIVED, preparedBy },
      { id: meetingId, hostId },
      'target-1',
      false,
      false,
    );
    expect(ok).toBe(true);
  });

  it('[T013][REGRESSION] non-shared, non-participant, non-host, non-admin is DENIED', async () => {
    shareRows = [];
    const ok = await callAccess(
      { id: minutesId, status: MeetingMinutesStatus.PUBLISHED, preparedBy },
      { id: meetingId, hostId },
      'random-user',
      false,
      false,
    );
    expect(ok).toBe(false);
  });

  it('[T013][REGRESSION] draft stays private to preparedBy — share does NOT apply to draft', async () => {
    shareRows = [{ minutesId, userId: 'target-1' }]; // even if shared
    const ok = await callAccess(
      { id: minutesId, status: MeetingMinutesStatus.DRAFT, preparedBy },
      { id: meetingId, hostId },
      'target-1',
      false,
      false,
    );
    expect(ok).toBe(false); // draft branch ignores shares
  });

  it('[T013] participant/host path returns true without querying shares', async () => {
    const ok = await callAccess(
      { id: minutesId, status: MeetingMinutesStatus.PUBLISHED, preparedBy },
      { id: meetingId, hostId },
      hostId,
      false,
      false,
    );
    expect(ok).toBe(true);
    expect(shareRepo.count).not.toHaveBeenCalled();
  });

  // ---------- shareMinutes (T014) ----------

  it('[AC-001] preparer grants share to an active user → 201 + audit', async () => {
    const res = await service.shareMinutes(
      minutesId,
      { userId: 'target-1' },
      { userId: preparedBy },
    );
    expect(res.userId).toBe('target-1');
    expect(res.userFullName).toBe('Target User');
    expect(shareRows).toHaveLength(1);
    expect(auditLog).toHaveBeenCalledWith(
      expect.objectContaining({ actionType: 'meeting_minutes_shared' }),
    );
  });

  it('[AC-006] business admin grants share (bypass ownership)', async () => {
    roles = ['BUSINESS_ADMIN'];
    const res = await service.shareMinutes(
      minutesId,
      { userId: 'target-1' },
      { userId: 'some-admin' },
    );
    expect(res.userId).toBe('target-1');
  });

  it('[AC-007] non-owner non-admin → 403 NOT_MINUTES_OWNER', async () => {
    await expect(
      service.shareMinutes(minutesId, { userId: 'target-1' }, { userId: 'stranger' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('[AC-009] grant on draft minutes → 409 MINUTES_NOT_PUBLISHED', async () => {
    minutesRow!.status = MeetingMinutesStatus.DRAFT;
    await expect(
      service.shareMinutes(minutesId, { userId: 'target-1' }, { userId: preparedBy }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('[AC-011] grant to inactive user → 422 USER_INACTIVE', async () => {
    targetUserRow!.accountStatus = AccountStatus.INACTIVE;
    await expect(
      service.shareMinutes(minutesId, { userId: 'target-1' }, { userId: preparedBy }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('[AC-012] grant to nonexistent user → 404 USER_NOT_FOUND', async () => {
    targetUserRow = null;
    await expect(
      service.shareMinutes(minutesId, { userId: 'ghost' }, { userId: preparedBy }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('[AC-013] duplicate grant (unique violation 23505) → 409 ALREADY_SHARED', async () => {
    saveThrows = { code: '23505' };
    await expect(
      service.shareMinutes(minutesId, { userId: 'target-1' }, { userId: preparedBy }),
    ).rejects.toMatchObject({
      response: { error: { code: 'ALREADY_SHARED' } },
    });
  });

  it('[AC-017] grant on nonexistent minutes → 404 MINUTES_NOT_FOUND', async () => {
    minutesRow = null;
    await expect(
      service.shareMinutes(minutesId, { userId: 'target-1' }, { userId: preparedBy }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  // ---------- unshareMinutes (T014) ----------

  it('[AC-004] revoke existing share → 200 + audit', async () => {
    shareRows = [{ minutesId, userId: 'target-1' }];
    const res = await service.unshareMinutes(minutesId, 'target-1', {
      userId: preparedBy,
    });
    expect(res.revoked).toBe(true);
    expect(shareRows).toHaveLength(0);
    expect(auditLog).toHaveBeenCalledWith(
      expect.objectContaining({ actionType: 'meeting_minutes_unshared' }),
    );
  });

  it('[AC-018] revoke non-existent share → 404 SHARE_NOT_FOUND', async () => {
    shareRows = [];
    await expect(
      service.unshareMinutes(minutesId, 'target-1', { userId: preparedBy }),
    ).rejects.toMatchObject({
      response: { error: { code: 'SHARE_NOT_FOUND' } },
    });
  });

  it('revoke on draft minutes → 409 MINUTES_NOT_PUBLISHED', async () => {
    minutesRow!.status = MeetingMinutesStatus.DRAFT;
    shareRows = [{ minutesId, userId: 'target-1' }];
    await expect(
      service.unshareMinutes(minutesId, 'target-1', { userId: preparedBy }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  // ---------- listMinutesShares (T014) ----------

  it('[AC-003] list returns shares with names', async () => {
    shareRows = [
      { id: 'share-1', minutesId, userId: 'target-1', grantedBy: hostId, grantedAt: new Date() },
    ];
    const res = await service.listMinutesShares(minutesId, { userId: preparedBy });
    expect(res.shares).toHaveLength(1);
    expect(res.shares[0].userFullName).toBe('Target User');
    expect(res.shares[0].grantedByName).toBe('Host User');
  });

  it('list is NOT blocked when minutes archived', async () => {
    minutesRow!.status = MeetingMinutesStatus.ARCHIVED;
    const res = await service.listMinutesShares(minutesId, { userId: preparedBy });
    expect(res.minutesId).toBe(minutesId);
  });

  it('list by non-owner non-admin → 403', async () => {
    await expect(
      service.listMinutesShares(minutesId, { userId: 'stranger' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
