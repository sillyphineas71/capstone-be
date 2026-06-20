/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any, @typescript-eslint/require-await */
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { SchedulerService } from './scheduler.service.js';
import { IotDevicesService } from '../iot/services/iot-devices.service.js';
import { NoShowDetectionService } from '../rooms/services/no-show-detection.service.js';
import { NoShowLifecycleService } from '../rooms/services/no-show-lifecycle.service.js';
import { FaceProvisioningService } from '../face-access/services/face-provisioning.service.js';

describe('SchedulerService (NSL-001 cron wiring)', () => {
  let detectMock: any;
  let lifecycleMock: any;
  let cfg: Record<string, unknown>;
  const calls: string[] = [];

  const build = async (): Promise<SchedulerService> => {
    calls.length = 0;
    detectMock = {
      detect: jest.fn(async () => {
        calls.push('detect');
        return { scanned: 0, created: 0 };
      }),
    };
    lifecycleMock = {
      reconcilePresence: jest.fn(async () => {
        calls.push('reconcile');
        return { scanned: 0, resolved: 0 };
      }),
      warnBatch: jest.fn(async () => {
        calls.push('warn');
        return { scanned: 0, warned: 0 };
      }),
      autoReleaseBatch: jest.fn(async () => ({
        scanned: 0,
        released: 0,
        skipped: 0,
      })),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SchedulerService,
        {
          provide: ConfigService,
          useValue: { get: (k: string, d?: unknown) => cfg[k] ?? d },
        },
        { provide: IotDevicesService, useValue: {} },
        { provide: NoShowDetectionService, useValue: detectMock },
        { provide: NoShowLifecycleService, useValue: lifecycleMock },
        { provide: FaceProvisioningService, useValue: {} },
      ],
    }).compile();
    return module.get(SchedulerService);
  };

  it('checkNoShow gate OFF (default) → KHÔNG gọi detect/warn', async () => {
    cfg = { SCHEDULER_ENABLED: true }; // no-show check default false
    const s = await build();
    await s.checkNoShow();
    expect(detectMock.detect).not.toHaveBeenCalled();
    expect(lifecycleMock.warnBatch).not.toHaveBeenCalled();
  });

  it('checkNoShow ON → thứ tự detect → reconcile → warn', async () => {
    cfg = { SCHEDULER_ENABLED: true, SCHEDULER_NO_SHOW_CHECK_ENABLED: true };
    const s = await build();
    await s.checkNoShow();
    expect(calls).toEqual(['detect', 'reconcile', 'warn']);
  });

  it('autoRelease gate OFF → KHÔNG gọi batch', async () => {
    cfg = { SCHEDULER_ENABLED: true };
    const s = await build();
    await s.autoRelease();
    expect(lifecycleMock.autoReleaseBatch).not.toHaveBeenCalled();
  });

  it('autoRelease ON → gọi autoReleaseBatch', async () => {
    cfg = { SCHEDULER_ENABLED: true, SCHEDULER_AUTO_RELEASE_ENABLED: true };
    const s = await build();
    await s.autoRelease();
    expect(lifecycleMock.autoReleaseBatch).toHaveBeenCalledTimes(1);
  });
});
