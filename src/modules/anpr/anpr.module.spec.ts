import 'reflect-metadata';
import { AnprModule } from './anpr.module.js';
import { ZonesModule } from '../zones/zones.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { AlertsModule } from '../alerts/alerts.module.js';

/**
 * GAW-001 / UC-105 — khoá wiring `anpr → zones` (writer gate_access_logs).
 *
 * ⚠ KHÔNG compile cả module (Test.createTestingModule({imports:[AnprModule]})) vì:
 * AnprModule kéo TypeOrmModule.forFeature + Auth/Notifications/Alerts/Zones/Iot — compile thật
 * cần DataSource + toàn bộ repo/service, sẽ fail vì THIẾU DB chứ không phải vì circular
 * (false negative). Repo không có tiền lệ compile module trong test.
 *
 * ĐÃ THỬ THỰC NGHIỆM (2026-07-24): `createTestingModule({imports:[AnprModule]})
 * .overrideProvider(getDataSourceToken()).useValue(mockDS).compile()` → FAIL với
 * "Nest can't resolve dependencies of the VehicleRegistrationEntityRepository (?) ...
 * DataSource at index [0] ... in TypeOrmModule" — lỗi DB-wiring (thiếu forRoot), KHÔNG phải
 * circular. Muốn compile phải dựng forRoot + DB (sqlite/thật) — ngoài phạm vi unit test.
 * ⇒ Circular được loại bằng chứng minh tĩnh dưới + bước boot app thủ công (tasks.md §vận hành).
 *
 * Bảo đảm KHÔNG circular ở đây bằng CHỨNG MINH TĨNH, không phải compile:
 * cạnh mới là `anpr → zones`; `zones` import Auth+Iot, `iot` import Auth — KHÔNG cái nào
 * import `anpr` (đã grep: không module nào import `anpr.module` ngoài `app.module`). Vì không
 * gì phụ thuộc `anpr`, thêm `anpr → zones` KHÔNG thể tạo chu trình qua `anpr`.
 *
 * Test dưới khoá metadata `imports` để refactor sau lỡ gỡ `ZonesModule` sẽ đỏ ngay.
 */
describe('AnprModule wiring (GAW-001 / UC-105)', () => {
  const imports = (Reflect.getMetadata('imports', AnprModule) ??
    []) as unknown[];

  it('import ZonesModule (nguồn GateAccessLogService cho writer)', () => {
    expect(imports).toContain(ZonesModule);
  });

  it('giữ nguyên các import cũ (không phá UC trước)', () => {
    expect(imports).toContain(AuthModule);
    expect(imports).toContain(NotificationsModule);
    expect(imports).toContain(AlertsModule);
  });
});
