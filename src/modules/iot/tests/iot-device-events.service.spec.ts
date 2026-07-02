import { Test, TestingModule } from '@nestjs/testing';
import { IotDeviceEventsService } from '../services/iot-device-events.service.js';
import { getRepositoryToken } from '@nestjs/typeorm';
import { IoTDeviceEventEntity } from '../entities/iot-device-event.entity.js';

describe('IotDeviceEventsService (Normalization)', () => {
  let service: IotDeviceEventsService;
  let mockRepo: any;

  beforeEach(async () => {
    mockRepo = {
      findOne: jest.fn(),
      find: jest.fn(),
      save: jest.fn((e) => Promise.resolve(e)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IotDeviceEventsService,
        {
          provide: getRepositoryToken(IoTDeviceEventEntity),
          useValue: mockRepo,
        },
      ],
    }).compile();

    service = module.get<IotDeviceEventsService>(IotDeviceEventsService);
  });

  const getBaseEvent = (
    eventType = 'face_verify',
    processedStatus = 'received',
  ): Partial<IoTDeviceEventEntity> => {
    return {
      id: 'mock-event-id',
      deviceId: 'mock-device-id',
      eventType,
      processedStatus,
      eventTime: new Date('2026-06-03T10:00:00.000Z'),
      payloadJson: {
        raw_payload_sample: {
          person_id: 'EMP123',
          person_name: 'John Doe',
          similarity: 98.5,
          timestamp: '2026-06-03T10:05:00.000Z',
        },
        device_snapshot: {
          device_code: 'DEV-01',
        },
        file_metadata: [],
        request_meta: {
          received_at: '2026-06-03T10:05:02.000Z',
        },
        payload_hash: 'mock-hash',
      },
    };
  };

  it('1. Test normalize face_verify thành công', async () => {
    const rawEvent = getBaseEvent();
    mockRepo.findOne.mockResolvedValue(rawEvent);

    const result: any = await service.normalizeRawEvent('mock-event-id');

    expect(result.processedStatus).toBe('processed');
    expect(result.errorMessage).toBeNull();
    expect(result.payloadJson.normalized_event).toBeDefined();
    expect(result.payloadJson.normalized_event.recognition_result).toBe(
      'recognized',
    );
    expect(result.payloadJson.normalized_event.person.device_person_id).toBe(
      'EMP123',
    );
  });

  it('2. Test normalize face_stranger thành công dù thiếu person id/name', async () => {
    const rawEvent = getBaseEvent('face_stranger');
    rawEvent.payloadJson.raw_payload_sample = {}; // empty person info
    mockRepo.findOne.mockResolvedValue(rawEvent);

    const result: any = await service.normalizeRawEvent('mock-event-id');

    expect(result.processedStatus).toBe('processed');
    expect(result.payloadJson.normalized_event.recognition_result).toBe(
      'stranger',
    );
    expect(
      result.payloadJson.normalized_event.person.device_person_id,
    ).toBeNull();
  });

  it('3. Test processedStatus = received đổi thành processed', async () => {
    const rawEvent = getBaseEvent();
    mockRepo.findOne.mockResolvedValue(rawEvent);

    const result: any = await service.normalizeRawEvent('mock-event-id');
    expect(result.processedStatus).toBe('processed');
  });

  it('4. Test payloadJson.normalized_event được merge vào', async () => {
    const rawEvent = getBaseEvent();
    mockRepo.findOne.mockResolvedValue(rawEvent);

    const result: any = await service.normalizeRawEvent('mock-event-id');
    expect(result.payloadJson.normalized_event).toBeDefined();
    expect(result.payloadJson.normalized_event.normalized_event_version).toBe(
      1,
    );
  });

  it('5. Test raw fields không bị sửa', async () => {
    const rawEvent = getBaseEvent();
    mockRepo.findOne.mockResolvedValue(rawEvent);

    const result: any = await service.normalizeRawEvent('mock-event-id');
    expect(result.payloadJson.raw_payload_sample).toBeDefined();
    expect(result.payloadJson.file_metadata).toBeDefined();
    expect(result.payloadJson.request_meta).toBeDefined();
    expect(result.payloadJson.device_snapshot).toBeDefined();
    expect(result.payloadJson.payload_hash).toBe('mock-hash');
  });

  it('6. Test tolerant alias extraction với PersonID', async () => {
    const rawEvent = getBaseEvent();
    rawEvent.payloadJson.raw_payload_sample = { PersonID: 'ID123' };
    mockRepo.findOne.mockResolvedValue(rawEvent);

    const result: any = await service.normalizeRawEvent('mock-event-id');
    expect(result.payloadJson.normalized_event.person.device_person_id).toBe(
      'ID123',
    );
  });

  it('7. Test tolerant alias extraction với nested object', async () => {
    const rawEvent = getBaseEvent();
    rawEvent.payloadJson.raw_payload_sample = {
      data: { person_id: 'NESTED123' },
    };
    mockRepo.findOne.mockResolvedValue(rawEvent);

    const result: any = await service.normalizeRawEvent('mock-event-id');
    expect(result.payloadJson.normalized_event.person.device_person_id).toBe(
      'NESTED123',
    );
  });

  it('8. Test date parsing với ISO string', async () => {
    const rawEvent = getBaseEvent();
    rawEvent.payloadJson.raw_payload_sample.timestamp =
      '2026-06-03T10:00:00.000Z';
    mockRepo.findOne.mockResolvedValue(rawEvent);

    const result: any = await service.normalizeRawEvent('mock-event-id');
    expect(result.payloadJson.normalized_event.event_time).toBe(
      '2026-06-03T10:00:00.000Z',
    );
  });

  it('9. Test date parsing với Unix milliseconds', async () => {
    const rawEvent = getBaseEvent();
    const timeMs = 1780416000000;
    rawEvent.payloadJson.raw_payload_sample.timestamp = timeMs;
    mockRepo.findOne.mockResolvedValue(rawEvent);

    const result: any = await service.normalizeRawEvent('mock-event-id');
    expect(result.payloadJson.normalized_event.event_time).toBe(
      new Date(timeMs).toISOString(),
    );
  });

  it('10. Test invalid timestamp fallback về eventTime', async () => {
    const rawEvent = getBaseEvent();
    rawEvent.payloadJson.raw_payload_sample.timestamp = 'invalid-date';
    mockRepo.findOne.mockResolvedValue(rawEvent);

    const result: any = await service.normalizeRawEvent('mock-event-id');
    expect(result.payloadJson.normalized_event.event_time).toBe(
      rawEvent.eventTime.toISOString(),
    );
  });

  it('11. Test unsupported event type chuyển thành ignored', async () => {
    const rawEvent = getBaseEvent('heartbeat');
    mockRepo.findOne.mockResolvedValue(rawEvent);

    const result: any = await service.normalizeRawEvent('mock-event-id');
    expect(result.processedStatus).toBe('ignored');
    expect(result.errorMessage).toBe(
      'Unsupported event type for normalization',
    );
  });

  it('12. Test technical error chuyển thành failed, errorMessage được sanitize', async () => {
    const rawEvent = getBaseEvent();
    mockRepo.save.mockImplementation((ev: any) => {
      if (ev.processedStatus === 'processed') {
        return Promise.reject(new Error('Connection lost password 1234'));
      }
      return Promise.resolve(ev);
    });
    mockRepo.findOne.mockResolvedValue(rawEvent);

    const result: any = await service.normalizeRawEvent('mock-event-id');
    expect(result.processedStatus).toBe('failed');
    expect(result.errorMessage).toContain('***');
  });

  it('13. Test batch normalize xử lý từng event độc lập, không làm dừng batch', async () => {
    const ev1 = getBaseEvent('face_verify');
    ev1.id = '1';
    const ev2 = getBaseEvent('heartbeat');
    ev2.id = '2'; // unsupported directly
    const ev3 = getBaseEvent('face_verify');
    ev3.id = '3';

    mockRepo.find.mockResolvedValue([ev1, ev2, ev3]);

    mockRepo.findOne.mockImplementation(({ where: { id } }: any) => {
      if (id === '1') return Promise.resolve(ev1);
      if (id === '2') return Promise.resolve(ev2);
      if (id === '3') return Promise.resolve(ev3);
      return Promise.resolve(null);
    });

    mockRepo.save.mockImplementation((ev: any) => {
      if (ev.id === '3' && ev.processedStatus === 'processed')
        throw new Error('DB error');
      return Promise.resolve(ev);
    });

    const summary = await service.normalizePendingRawEvents(10);
    expect(summary.total).toBe(3);
    expect(summary.processed).toBe(1);
    expect(summary.ignored).toBe(1);
    expect(summary.failed).toBe(1);
  });

  it('14. Test event đã processed/ignored/failed không bị normalize lại', async () => {
    const rawEvent = getBaseEvent('face_verify', 'processed');
    mockRepo.findOne.mockResolvedValue(rawEvent);

    const result: any = await service.normalizeRawEvent('mock-event-id');
    expect(result.status).toBe('skipped');
    // save shouldn't be called from this normalize flow since it early returned
  });
});
