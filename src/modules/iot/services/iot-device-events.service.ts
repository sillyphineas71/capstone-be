import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, EntityManager } from 'typeorm';
import * as crypto from 'crypto';
import {
  IoTDeviceEventEntity,
  IoTDeviceEventType,
  IoTEventSourceProtocol,
  IoTEventSeverity,
  IoTEventProcessedStatus,
} from '../entities/iot-device-event.entity.js';
import { IoTDeviceEntity } from '../entities/iot-device.entity.js';

export interface StoreRawEventInput {
  device: IoTDeviceEntity;
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
  private readonly logger = new Logger(IotDeviceEventsService.name);

  constructor(
    @InjectRepository(IoTDeviceEventEntity)
    private readonly iotDeviceEventsRepository: Repository<IoTDeviceEventEntity>,
  ) {}

  async storeRawEvent(
    input: StoreRawEventInput,
    entityManager?: EntityManager,
  ): Promise<IoTDeviceEventEntity> {
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

    const eventTime = this.getValidDate(occurredAt)
      ? (occurredAt as Date)
      : receivedAt;

    const event = new IoTDeviceEventEntity();
    event.deviceId = device.id;
    event.roomId = device.roomId || null;
    event.meetingId = null;
    event.eventType =
      eventType === 'face_verify'
        ? IoTDeviceEventType.FACE_VERIFY
        : IoTDeviceEventType.FACE_STRANGER;
    event.eventTime = eventTime;
    event.sourceProtocol = sourceProtocol as IoTEventSourceProtocol;
    event.severity =
      severity === 'warning' ? IoTEventSeverity.WARNING : IoTEventSeverity.INFO;
    event.payloadJson = payloadJson;
    event.processedStatus = IoTEventProcessedStatus.RECEIVED;
    event.errorMessage = null;

    const repo = entityManager
      ? entityManager.getRepository(IoTDeviceEventEntity)
      : this.iotDeviceEventsRepository;

    // Insert into database, throw error if fails
    return await repo.save(event);
  }

  private getValidDate(date?: Date | null): boolean {
    if (!date) return false;
    const time = date.getTime();
    return !isNaN(time) && time > 0;
  }

  async normalizeRawEvent(
    rawEventId: string,
  ): Promise<IoTDeviceEventEntity | { status: string; reason: string }> {
    const event = await this.iotDeviceEventsRepository.findOne({
      where: { id: rawEventId },
    });
    if (!event) {
      throw new NotFoundException({
        code: 'RAW_EVENT_NOT_FOUND',
        message: 'Raw event not found.',
      });
    }

    if (event.processedStatus !== IoTEventProcessedStatus.RECEIVED) {
      return {
        status: 'skipped',
        reason: 'Already processed or invalid status',
      };
    }

    if (
      event.eventType !== IoTDeviceEventType.FACE_VERIFY &&
      event.eventType !== IoTDeviceEventType.FACE_STRANGER
    ) {
      event.processedStatus = IoTEventProcessedStatus.IGNORED;
      event.errorMessage = 'Unsupported event type for normalization';
      return await this.iotDeviceEventsRepository.save(event);
    }

    try {
      const normalizedEvent = this.buildNormalizedEvent(event);

      // Clone payloadJson to avoid mutating the original reference directly, then merge
      const updatedPayloadJson = {
        ...event.payloadJson,
        normalized_event: normalizedEvent,
      };

      event.payloadJson = updatedPayloadJson;
      event.processedStatus = IoTEventProcessedStatus.PROCESSED;
      event.errorMessage = null;

      return await this.iotDeviceEventsRepository.save(event);
    } catch (error: any) {
      this.logger.error(
        `Failed to normalize event ${rawEventId}: ${error.message}`,
        error.stack,
      );
      event.processedStatus = IoTEventProcessedStatus.FAILED;
      let safeError = error.message || 'Unknown error';
      // Basic masking for potential tokens
      safeError = safeError.replace(
        /(token|password|secret)["':= ]+([a-zA-Z0-9\-_]+)/gi,
        '$1: ***',
      );
      event.errorMessage = safeError.substring(0, 500); // short error
      return await this.iotDeviceEventsRepository.save(event);
    }
  }

  async normalizePendingRawEvents(limit: number): Promise<any> {
    const events = await this.iotDeviceEventsRepository.find({
      where: [
        {
          processedStatus: IoTEventProcessedStatus.RECEIVED,
          eventType: IoTDeviceEventType.FACE_VERIFY,
        },
        {
          processedStatus: IoTEventProcessedStatus.RECEIVED,
          eventType: IoTDeviceEventType.FACE_STRANGER,
        },
      ],
      order: { createdAt: 'ASC' },
      take: limit,
    });

    const total = events.length;
    let processed = 0;
    let ignored = 0;
    let failed = 0;
    let skipped = 0;

    for (const event of events) {
      try {
        const result = await this.normalizeRawEvent(event.id);
        if ('status' in result && result.status === 'skipped') {
          skipped++;
        } else if (result && 'processedStatus' in result) {
          const ps = result.processedStatus as string;
          if (ps === 'processed') processed++;
          else if (ps === 'ignored') ignored++;
          else if (ps === 'failed') failed++;
        }
      } catch (error) {
        this.logger.error(
          `Batch normalize error for event ${event.id}: ${error}`,
        );
        failed++;
      }
    }

    return { total, processed, ignored, failed, skipped };
  }

  private buildNormalizedEvent(rawEvent: IoTDeviceEventEntity): any {
    const payloadJson = (rawEvent.payloadJson || {}) as any;
    const payload = payloadJson.raw_payload_sample || {};
    const extracted = payloadJson.extracted_fields || {};

    // Combine payload and extracted to find fields
    const searchSource = {
      ...payload,
      ...extracted,
      data: payload.data || {},
      info: payload.info || {},
    };

    const devicePersonId = this.extractField(searchSource, [
      'person_id',
      'personId',
      'PersonID',
      'UserID',
      'user_id',
      'EmployeeID',
      'employee_id',
      'card_no',
      'CardNo',
      'id',
      'data.person_id',
      'data.personId',
      'data.PersonID',
      'info.PersonID',
    ]);
    const devicePersonName = this.extractField(searchSource, [
      'person_name',
      'personName',
      'PersonName',
      'name',
      'Name',
      'UserName',
      'employee_name',
      'EmployeeName',
      'data.personName',
      'info.PersonName',
    ]);
    const devicePersonCode = this.extractField(searchSource, [
      'person_code',
      'personCode',
      'PersonCode',
      'employee_code',
      'EmployeeCode',
    ]);

    const similarityVal = this.extractField(searchSource, [
      'similarity',
      'Similarity',
      'score',
      'Score',
      'confidence',
      'confidence_score',
      'Confidence',
      'FaceScore',
      'data.similarity',
      'info.Similarity',
    ]);

    const similarity =
      similarityVal !== null && !isNaN(Number(similarityVal))
        ? Number(similarityVal)
        : null;

    const eventTimeVal = this.extractField(searchSource, [
      'event_time',
      'eventTime',
      'EventTime',
      'capture_time',
      'captureTime',
      'CaptureTime',
      'verify_time',
      'verifyTime',
      'VerifyTime',
      'timestamp',
      'Timestamp',
      'time',
      'Time',
    ]);

    const dbEventTime = rawEvent.eventTime;
    const requestReceivedAt = payloadJson.request_meta?.received_at
      ? new Date(payloadJson.request_meta.received_at)
      : new Date();

    const finalEventTime = this.parseTolerantDate(
      eventTimeVal,
      dbEventTime,
      requestReceivedAt,
    );

    const recognitionResult =
      rawEvent.eventType === IoTDeviceEventType.FACE_VERIFY
        ? 'recognized'
        : 'stranger';

    const deviceSnapshot = payloadJson.device_snapshot || {};
    const fileMetadata = payloadJson.file_metadata || [];

    return {
      normalized_event_version: 1,
      source: 'face_server',
      raw_event_id: rawEvent.id,
      event_type: rawEvent.eventType,
      recognition_result: recognitionResult,
      device: {
        device_id: rawEvent.deviceId,
        device_code: deviceSnapshot.device_code || null,
        device_type: deviceSnapshot.device_type || null,
        room_id: deviceSnapshot.room_id || null,
      },
      person: {
        device_person_id: devicePersonId,
        device_person_code: devicePersonCode,
        device_person_name: devicePersonName,
      },
      event_time: finalEventTime.toISOString(),
      received_at: requestReceivedAt.toISOString(),
      recognition: {
        similarity: similarity,
        confidence_score: similarity,
        threshold: null,
      },
      media: {
        has_image: fileMetadata.length > 0,
        file_count: fileMetadata.length,
        file_metadata: fileMetadata,
      },
      normalization: {
        status: 'success',
        normalized_at: new Date().toISOString(),
        mapper_version: 'face_server_v1',
      },
    };
  }

  private extractField(payload: any, possibleKeys: string[]): any {
    if (!payload || typeof payload !== 'object') return null;

    for (const key of possibleKeys) {
      if (key.includes('.')) {
        const parts = key.split('.');
        let current = payload;
        let found = true;
        for (const part of parts) {
          if (current !== null && current !== undefined && part in current) {
            current = current[part];
          } else {
            found = false;
            break;
          }
        }
        if (
          found &&
          current !== null &&
          current !== undefined &&
          current !== ''
        ) {
          return current;
        }
      } else {
        if (
          key in payload &&
          payload[key] !== null &&
          payload[key] !== undefined &&
          payload[key] !== ''
        ) {
          return payload[key];
        }
      }
    }
    return null;
  }

  private parseTolerantDate(
    payloadVal: any,
    dbEventTime: Date,
    requestReceivedAt: Date,
  ): Date {
    if (payloadVal) {
      const numVal = Number(payloadVal);
      if (!isNaN(numVal)) {
        if (numVal > 100000000000) {
          return new Date(numVal);
        } else {
          return new Date(numVal * 1000);
        }
      }

      const parsed = new Date(payloadVal);
      if (!isNaN(parsed.getTime())) {
        return parsed;
      }
    }

    if (dbEventTime && !isNaN(dbEventTime.getTime())) {
      return dbEventTime;
    }

    return requestReceivedAt;
  }
}
