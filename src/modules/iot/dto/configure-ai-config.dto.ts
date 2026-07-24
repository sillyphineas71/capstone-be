import { IsOptional, IsBoolean } from 'class-validator';
import { Expose } from 'class-transformer';

/**
 * ConfigureAiConfigDto (IAC-001 / UC-96) — bật/tắt chức năng AI của camera.
 * PATCH /iot-devices/:id/ai-config → ghi `metadata_json.ai_config`.
 *
 * ⚠ MAP CỜ → LOẠI EVENT (cho consumer phát-hiện-lệch cấu hình ở UC-105 — KHÔNG dùng nhãn UI
 * IVSS; consumer so "cờ khai tắt" với "event loại đó vẫn về"):
 *   - face_recognition  → ivss_face_event
 *   - plate_recognition → vehicle plate event (sự kiện biển số)
 *   - people_counting   → occupancy event (sự kiện đếm người / hiện diện khu vực)
 *
 * ⚠ NGỮ NGHĨA MERGE: cờ GỬI → cập nhật; cờ KHÔNG gửi → giữ nguyên (service merge từng cờ,
 * không replace cả cụm). Cả 3 @IsOptional chính vì merge.
 *
 * ⚠ `absent` ≠ `false`: khoá VẮNG MẶT = admin CHƯA khai; `false` = admin KHAI phải tắt. Lần
 * PATCH đầu chỉ gửi 1 cờ ⇒ 2 cờ kia vẫn vắng mặt, KHÔNG mặc định thành `false`. Consumer
 * (UC-105) chỉ cảnh báo lệch khi cờ `false` TƯỜNG MINH.
 *
 * ⚠⚠ Config là TUYÊN BỐ Ý ĐỊNH của quản trị viên, KHÔNG phải trạng thái thật của thiết bị
 * (BE không đẩy được xuống camera/IVSS). CẤM dùng để lọc/chặn event.
 */
export class ConfigureAiConfigDto {
  @Expose({ name: 'face_recognition' })
  @IsOptional()
  @IsBoolean()
  faceRecognition?: boolean;

  @Expose({ name: 'plate_recognition' })
  @IsOptional()
  @IsBoolean()
  plateRecognition?: boolean;

  @Expose({ name: 'people_counting' })
  @IsOptional()
  @IsBoolean()
  peopleCounting?: boolean;
}
