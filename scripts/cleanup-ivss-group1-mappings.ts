import 'reflect-metadata';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { AppDataSource } from '../src/database/data-source';
import { IvssBridgeClient } from '../src/modules/ivss/clients/ivss-bridge.client';

// Load .env từ root project
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

/**
 * Script dọn rác 1 LẦN (KHÔNG phải cron) — gộp về 1 group IVSS duy nhất
 * (portrait/"USERS"), loại bỏ group "1" (theo họp). Chạy tay bằng:
 *
 *   npx tsx scripts/cleanup-ivss-group1-mappings.ts
 *
 * Điều kiện tiên quyết: SCHEDULER_IVSS_SYNC_ENABLED=false (Pha 1) — nếu
 * không, cron `ivss-sync` có thể enroll lại vào group "1" song song với
 * script này đang xoá, gây race. Script KHÔNG tự kiểm tra cờ này — admin
 * xác nhận trước khi chạy.
 *
 * Field xoá: device_person_id (UID do THIẾT BỊ tự sinh lúc enroll) — ĐÚNG
 * field đang dùng trong IvssPersonSyncService.cleanupEnded() hiện tại, đối
 * chiếu bằng chứng sep490_ams_be delFaceRecognitionDB (production). KHÔNG
 * dùng device_person_code.
 *
 * groupId hardcode '1' — đây là group ĐANG BỊ LOẠI BỎ, cố ý KHÔNG đọc từ
 * IVSS_DEFAULT_GROUP (config có thể đã đổi sang group khác/portrait rồi).
 */
const GROUP_TO_CLEAN = '1';
const DELAY_MS = 300;

interface MappingRow {
  id: string;
  user_id: string;
  device_person_id: string | null;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function run(): Promise<void> {
  console.log('Connecting to database...');
  await AppDataSource.initialize();
  console.log('Connected.\n');

  const bridge = new IvssBridgeClient({
    baseUrl: process.env.IVSS_BRIDGE_BASE_URL ?? '',
    token: process.env.IVSS_BRIDGE_TOKEN ?? '',
    timeoutMs: Number(process.env.IVSS_BRIDGE_TIMEOUT_MS ?? 8000),
  });

  const rows: MappingRow[] = await AppDataSource.query(
    `SELECT id, user_id, device_person_id
     FROM device_user_mappings
     WHERE metadata_json->>'source' = 'ivss' AND deleted_at IS NULL`,
  );
  console.log(`Found ${rows.length} mapping(s) with source='ivss' to clean up.\n`);

  const successIds: string[] = [];
  const failed: Array<{ id: string; userId: string; reason: string }> = [];

  for (const row of rows) {
    try {
      if (!row.device_person_id) {
        // Chưa từng sync xuống thiết bị (device_person_id null) — không có
        // gì để gọi deleteFace, chỉ cần dọn dòng DB.
        console.log(
          `[skip-delete] mapping=${row.id} user=${row.user_id} — device_person_id NULL, không gọi bridge.`,
        );
        successIds.push(row.id);
        continue;
      }

      const r = await bridge.deleteFace({
        groupId: GROUP_TO_CLEAN,
        personUid: row.device_person_id,
      });

      if (r.ok) {
        console.log(
          `[ok] mapping=${row.id} user=${row.user_id} device_person_id=${row.device_person_id} — đã xoá trên IVSS.`,
        );
        successIds.push(row.id);
      } else {
        console.warn(
          `[fail] mapping=${row.id} user=${row.user_id} device_person_id=${row.device_person_id} — bridge trả lỗi: ${r.error.code} ${r.error.message}`,
        );
        failed.push({ id: row.id, userId: row.user_id, reason: `${r.error.code} ${r.error.message}` });
      }
    } catch (e) {
      // Best-effort: KHÔNG để 1 dòng lỗi chặn cả batch.
      const msg = e instanceof Error ? e.message : 'unknown';
      console.warn(`[fail] mapping=${row.id} user=${row.user_id} — exception: ${msg}`);
      failed.push({ id: row.id, userId: row.user_id, reason: msg });
    }

    // Delay nhỏ giữa mỗi lần gọi — KHÔNG dí liên tục vào SDK.
    await sleep(DELAY_MS);
  }

  if (successIds.length > 0) {
    await AppDataSource.query(
      `UPDATE device_user_mappings SET deleted_at = now() WHERE id = ANY($1::uuid[])`,
      [successIds],
    );
  }

  console.log('\n─── Summary ───────────────────────────────────────────────');
  console.log(`Scanned:  ${rows.length}`);
  console.log(`Success:  ${successIds.length} (deleted_at đã cập nhật)`);
  console.log(`Failed:   ${failed.length} (GIỮ LẠI, deleted_at KHÔNG đổi — cần đối chiếu UI IVSS)`);
  if (failed.length > 0) {
    console.log('\nDanh sách thất bại (user_id | mapping_id | lý do):');
    for (const f of failed) {
      console.log(`  - ${f.userId} | ${f.id} | ${f.reason}`);
    }
  }

  await AppDataSource.destroy();
  process.exit(failed.length > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
