import 'reflect-metadata';
import { IvssModule } from './ivss.module.js';
import { ZonesModule } from '../zones/zones.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { PresenceModule } from '../presence/presence.module.js';

/**
 * ZPW-001 / UC-109 — khoá wiring `ivss → zones` (writer zone_presence_events).
 *
 * ⚠ KHÔNG compile cả module (Test.createTestingModule({imports:[IvssModule]})) — mirror
 * anpr.module.spec.ts (UC-105): compile thật fail vì thiếu TypeOrmModule.forRoot/DataSource,
 * KHÔNG phải circular (false negative). Bảo đảm không-circular bằng CHỨNG MINH TĨNH:
 * cạnh mới `ivss → zones`; `zones` import Auth+Iot, không import `ivss`; `auth`/`iot` cũng
 * không import `ivss`. Không gì mà `zones` phụ thuộc kéo về `ivss` ⇒ không chu trình.
 * (scheduler → ivss là consumer trên cùng, không liên quan chu trình.)
 *
 * Test khoá metadata `imports` để refactor sau lỡ gỡ `ZonesModule` sẽ đỏ ngay.
 */
describe('IvssModule wiring (ZPW-001 / UC-109)', () => {
  const imports = (Reflect.getMetadata('imports', IvssModule) ??
    []) as unknown[];

  it('import ZonesModule (nguồn ZonePresenceWriterService cho writer)', () => {
    expect(imports).toContain(ZonesModule);
  });

  it('giữ nguyên import cũ (không phá luồng điểm danh)', () => {
    expect(imports).toContain(AuthModule);
    expect(imports).toContain(PresenceModule);
  });
});
