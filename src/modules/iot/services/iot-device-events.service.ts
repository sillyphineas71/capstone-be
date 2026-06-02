import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, EntityManager } from 'typeorm';
import { IotDeviceEvent } from '../entities/iot-device-event.entity';
import { IotDevice } from '../entities/iot-device.entity';

export interface StoreRawEventInput {
  device: IotDevice;
  eventType: 'face_verify' | 'face_stranger';
  sourceProtocol: 'http' | string;
  severity: 'info' | 'warning';
  receivedAt: Date;
  occurredAt?: Date | null;
  sourceIp: string;
  httpMethod: string;
  contentType: string;
  contentLength: string | number;
  rawPayloadSample: any;
  fileMetadata: any[];
  extractedFields: any;
  storedByUc?: string;
}

@Injectable()
export class IotDeviceEventsService {
  constructor(
    @InjectRepository(IotDeviceEvent)
    private readonly iotDeviceEventsRepository: Repository<IotDeviceEvent>,
  ) {}

  async storeRawEvent(
    input: StoreRawEventInput,
    entityManager?: EntityManager,
  ): Promise<IotDeviceEvent> {
    const {
      device,
      eventType,
      sourceProtocol,
      severity,
      receivedAt,
      occurredAt,
      sourceIp,
      httpMethod,
      contentType,
      contentLength,
      rawPayloadSample,
      fileMetadata,
      extractedFields,
      storedByUc = 'IOT-009',
    } = input;

    // Build payload_json
    // Payload hash should be calculated BEFORE this point and passed inside rawPayloadSample or extractedFields,
    // or we calculate it here. The requirements say:
    // "Tính SHA-256 từ object đã sanitize", "Không đưa plain callback token vào hash".
    // We assume the caller (IotDevicesService) has already sanitized the rawPayloadSample
    // but the hashing could be done here.

    // Actually, let's calculate the hash here from the sanitized components to be safe,
    // or assume the caller passed it in extractedFields. We'll do it here if it's not present.
    // Wait, the spec says: "Tính SHA-256 từ object đã sanitize... Lưu hash vào payload_json.payload_hash."
    const crypto = require('crypto');
    const hashInput = JSON.stringify({
      device_id: device.id,
      event_type: eventType,
      raw_payload_sample: rawPayloadSample,
      file_metadata: fileMetadata,
      occurred_at: occurredAt || null,
    });
    const payloadHash = crypto
      .createHash('sha256')
      .update(hashInput)
      .digest('hex');

    const payloadJson = {
      raw_payload_sample: rawPayloadSample,
      file_metadata: fileMetadata,
      request_meta: {
        source_ip: sourceIp,
        http_method: httpMethod,
        content_type: contentType,
        content_length: contentLength,
        received_at: receivedAt.toISOString(),
      },
      device_snapshot: {
        device_code: device.deviceCode,
        device_type: device.deviceType,
        room_id: device.roomId || null,
      },
      extracted_fields: extractedFields,
      payload_hash: payloadHash,
      raw_event_version: 1,
      stored_by_uc: storedByUc,
    };

    const eventTime = this.getValidDate(occurredAt) ? (occurredAt as Date) : receivedAt;

    const event = new IotDeviceEvent();
    event.deviceId = device.id;
    event.roomId = device.roomId || null;
    event.meetingId = null;
    event.eventType = eventType;
    event.eventTime = eventTime;
    event.sourceProtocol = sourceProtocol;
    event.severity = severity;
    event.payloadJson = payloadJson;
    event.processedStatus = 'received';
    event.errorMessage = null;

    const repo = entityManager
      ? entityManager.getRepository(IotDeviceEvent)
      : this.iotDeviceEventsRepository;

    // Insert into database, throw error if fails
    return await repo.save(event);
  }

  private getValidDate(date?: Date | null): boolean {
    if (!date) return false;
    const time = date.getTime();
    return !isNaN(time) && time > 0;
  }
}
