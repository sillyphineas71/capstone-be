/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/require-await */
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { SchedulerService } from './scheduler.service.js';
import { CheckInAlertService } from '../attendance/services/checkin-alert.service.js';
import { IotDevicesService } from '../iot/services/iot-devices.service.js';
import { NoShowDetectionService } from '../rooms/services/no-show-detection.service.js';
import { NoShowLifecycleService } from '../rooms/services/no-show-lifecycle.service.js';
import { EarlyVacancyService } from '../rooms/services/early-vacancy.service.js';
import { FaceProvisioningService } from '../face-access/services/face-provisioning.service.js';
import { IvssPersonSyncService } from '../ivss/services/ivss-person-sync.service.js';
import { GateLogPairingService } from '../zones/services/gate-log-pairing.service.js';

describe('SchedulerService (NSL-001 + EVD-001 + IPS-001 cron wiring)', () => {
  let detectMock: any;
  let lifecycleMock: any;
  let earlyVacancyMock: any;
  let ivssMock: any;
  let gatePairingMock: any;
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
    earlyVacancyMock = {
      detect: jest.fn(async () => ({ scanned: 0, flagged: 0 })),
    };
    ivssMock = {
      provisionUpcoming: jest.fn(async () => ({
        scanned: 0,
        enrolled: 0,
        skipped: 0,
        failed: 0,
      })),
      cleanupEnded: jest.fn(async () => ({
        scanned: 0,
        removed: 0,
        failed: 0,
      })),
    };
    gatePairingMock = {
      pairBatch: jest.fn(async () => ({ scanned: 0, paired: 0, skipped: 0 })),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SchedulerService,
        {
          provide: ConfigService,
          useValue: { get: (k: string, d?: unknown) => cfg[k] ?? d },
        },
        { provide: CheckInAlertService, useValue: {} },
        { provide: IotDevicesService, useValue: {} },
        { provide: NoShowDetectionService, useValue: detectMock },
        { provide: NoShowLifecycleService, useValue: lifecycleMock },
        { provide: EarlyVacancyService, useValue: earlyVacancyMock },
        { provide: FaceProvisioningService, useValue: {} },
        { provide: IvssPersonSyncService, useValue: ivssMock },
        { provide: GateLogPairingService, useValue: gatePairingMock },
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

  // ── EVD-001 earlyVacancy cron ──
  it('earlyVacancy gate OFF (default) → KHÔNG gọi detect', async () => {
    cfg = { SCHEDULER_ENABLED: true };
    const s = await build();
    await s.earlyVacancy();
    expect(earlyVacancyMock.detect).not.toHaveBeenCalled();
  });

  it('earlyVacancy ON → gọi detect 1 lần', async () => {
    cfg = { SCHEDULER_ENABLED: true, SCHEDULER_EARLY_VACANCY_ENABLED: true };
    const s = await build();
    await s.earlyVacancy();
    expect(earlyVacancyMock.detect).toHaveBeenCalledTimes(1);
  });

  it('earlyVacancy: detect throw → KHÔNG ném ra cron (ARCH-02)', async () => {
    cfg = { SCHEDULER_ENABLED: true, SCHEDULER_EARLY_VACANCY_ENABLED: true };
    const s = await build();
    earlyVacancyMock.detect.mockRejectedValueOnce(new Error('boom'));
    await expect(s.earlyVacancy()).resolves.toBeUndefined();
  });

  // ── IPS-001 ivssSync cron ──
  it('ivssSync gate OFF (default) → KHÔNG gọi provision/cleanup', async () => {
    cfg = { SCHEDULER_ENABLED: true };
    const s = await build();
    await s.ivssSync();
    expect(ivssMock.provisionUpcoming).not.toHaveBeenCalled();
    expect(ivssMock.cleanupEnded).not.toHaveBeenCalled();
  });

  it('ivssSync ON → gọi provision + cleanup', async () => {
    cfg = { SCHEDULER_ENABLED: true, SCHEDULER_IVSS_SYNC_ENABLED: true };
    const s = await build();
    await s.ivssSync();
    expect(ivssMock.provisionUpcoming).toHaveBeenCalledTimes(1);
    expect(ivssMock.cleanupEnded).toHaveBeenCalledTimes(1);
  });

  it('ivssSync: provision throw → KHÔNG ném ra cron (ARCH-02)', async () => {
    cfg = { SCHEDULER_ENABLED: true, SCHEDULER_IVSS_SYNC_ENABLED: true };
    const s = await build();
    ivssMock.provisionUpcoming.mockRejectedValueOnce(new Error('boom'));
    await expect(s.ivssSync()).resolves.toBeUndefined();
  });

  // ── GAP-001 gateLogPairing cron (UC-106) ──
  it('gateLogPairing gate OFF (default) → KHÔNG gọi pairBatch', async () => {
    cfg = { SCHEDULER_ENABLED: true }; // SCHEDULER_GATE_PAIRING_ENABLED default false
    const s = await build();
    await s.gateLogPairing();
    expect(gatePairingMock.pairBatch).not.toHaveBeenCalled();
  });

  it('gateLogPairing ON → gọi pairBatch 1 lần', async () => {
    cfg = { SCHEDULER_ENABLED: true, SCHEDULER_GATE_PAIRING_ENABLED: true };
    const s = await build();
    await s.gateLogPairing();
    expect(gatePairingMock.pairBatch).toHaveBeenCalledTimes(1);
  });

  it('gateLogPairing: pairBatch throw → KHÔNG ném ra cron (ARCH-02)', async () => {
    cfg = { SCHEDULER_ENABLED: true, SCHEDULER_GATE_PAIRING_ENABLED: true };
    const s = await build();
    gatePairingMock.pairBatch.mockRejectedValueOnce(new Error('boom'));
    await expect(s.gateLogPairing()).resolves.toBeUndefined();
  });
});
