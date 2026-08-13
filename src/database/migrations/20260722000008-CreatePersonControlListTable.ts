import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * SAVP Security Alert Center scope — tạo bảng `person_control_list` (UC-125: Danh sách
 * kiểm soát người / Watchlist, đã duyệt — xem BAO_CAO_DE_XUAT_3_BANG_ALERT_CENTER.md +
 * PHAN_HOI_DUYET_3_BANG_ALERT_CENTER.md, 2026-07-22).
 *
 * Schema-only: KHÔNG controller/service/DTO/nghiệp vụ — CRUD + đối chiếu khi nhận diện
 * làm ở UC-125 sau. Viết TAY (KHÔNG migration:generate). Mirror style
 * 20260721000006-CreateVehicleControlListTable.ts nhưng cho NGƯỜI thay vì biển số.
 *
 * DATA-02: CHỈ CREATE/DROP `person_control_list` + 4 index của nó — KHÔNG đụng bảng
 * khác. Phụ thuộc: `users`, `face_profiles`, `media_files`.
 *
 * `user_id`/`face_profile_id` đều nullable — người ngoài chỉ có ảnh (không tài
 * khoản/hồ sơ khuôn mặt trong hệ thống) vẫn quản lý được qua `display_name` +
 * `photo_media_file_id`. Độc lập danh sách nhân sự đang hoạt động (SRS UC-125 BR1:
 * người đã nghỉ việc vẫn nằm trong watchlist được).
 *
 * `list_type` thêm theo review Hải (§1.3) — đối xứng `vehicle_control_list.list_type`,
 * tránh bất đối xứng giữa 2 bảng cùng vai trò kiểm soát.
 *
 * `photo_media_file_id`: ẢNH CHỈ LƯU ĐỂ ĐỐI CHIẾU THỦ CÔNG (quyết định Hải §2.3) —
 * KHÔNG enroll lên thiết bị nhận diện đợt này (cron cleanupEnded bên face-access sẽ xoá
 * khuôn mặt không gắn cuộc họp nào; watchlist là thường trực nên sẽ bị xoá nhầm nếu dùng
 * chung cơ chế enroll hiện tại — auto-match qua thiết bị là UC riêng sau).
 *
 * TÁCH 2 cặp partial unique theo `user_id`/`face_profile_id` (mirror bẫy NULL != NULL
 * của `alert_rules`/`security_alerts`) — người chỉ có `display_name` (không có cả hai
 * FK) không dedup được, chấp nhận trùng.
 */
export class CreatePersonControlListTable20260722000008 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "person_control_list" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "user_id" uuid,
        "face_profile_id" uuid,
        "display_name" varchar(255) NOT NULL,
        "photo_media_file_id" uuid,
        "list_type" varchar(20) NOT NULL DEFAULT 'watchlist',
        "reason" varchar(255),
        "priority" varchar(20) NOT NULL DEFAULT 'medium',
        "active" boolean NOT NULL DEFAULT true,
        "created_by" uuid,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz,
        CONSTRAINT "PK_person_control_list_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_person_control_list_user" FOREIGN KEY ("user_id")
          REFERENCES "users" ("id") ON DELETE SET NULL,
        CONSTRAINT "FK_person_control_list_face_profile" FOREIGN KEY ("face_profile_id")
          REFERENCES "face_profiles" ("id") ON DELETE SET NULL,
        CONSTRAINT "FK_person_control_list_photo" FOREIGN KEY ("photo_media_file_id")
          REFERENCES "media_files" ("id") ON DELETE SET NULL,
        CONSTRAINT "FK_person_control_list_created_by" FOREIGN KEY ("created_by")
          REFERENCES "users" ("id") ON DELETE SET NULL
      )
    `);

    // Dedup theo user_id (chỉ áp dụng khi có link tài khoản).
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_person_control_user_type_active"
        ON "person_control_list" ("user_id", "list_type")
        WHERE "deleted_at" IS NULL AND "user_id" IS NOT NULL
    `);

    // Dedup theo face_profile_id (chỉ áp dụng khi có link hồ sơ khuôn mặt).
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_person_control_face_type_active"
        ON "person_control_list" ("face_profile_id", "list_type")
        WHERE "deleted_at" IS NULL AND "face_profile_id" IS NOT NULL
    `);

    // Hot path: đối chiếu khi có event nhận diện theo user.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_person_control_lookup_user"
        ON "person_control_list" ("user_id")
        WHERE "deleted_at" IS NULL AND "active" = true
    `);

    // Hot path: đối chiếu khi có event nhận diện theo face_profile.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_person_control_lookup_face"
        ON "person_control_list" ("face_profile_id")
        WHERE "deleted_at" IS NULL AND "active" = true
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_person_control_lookup_face"`);
    await queryRunner.query(`DROP INDEX "IDX_person_control_lookup_user"`);
    await queryRunner.query(`DROP INDEX "UQ_person_control_face_type_active"`);
    await queryRunner.query(`DROP INDEX "UQ_person_control_user_type_active"`);
    await queryRunner.query(`DROP TABLE "person_control_list"`);
  }
}
