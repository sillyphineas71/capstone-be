import { AppDataSource } from '../src/database/data-source.js';

/**
 * READ-ONLY investigation script.
 *
 * Giả thuyết: khi sửa giờ/phòng một meeting đã SCHEDULED, lỗi "phòng không còn
 * trống" tự đụng với chính booking cũ của meeting đó xảy ra vì code loại trừ
 * xung đột bằng `Not(activeBooking.id)` — chỉ loại 1 dòng lấy qua `findOne()`
 * (không ORDER BY). Nếu một meeting có >1 dòng room_bookings đang ở trạng thái
 * pending/approved/active cùng lúc, `findOne()` chỉ trả về 1 dòng ngẫu nhiên,
 * dòng còn lại vẫn nằm trong tập conflict → tự đụng chính mình.
 *
 * Script này KHÔNG sửa dữ liệu, chỉ SELECT để xác nhận/loại giả thuyết.
 */
async function main(): Promise<void> {
  await AppDataSource.initialize();

  // 1) Meeting nào đang có >1 room_booking "sống" (pending/approved/active) cùng lúc?
  const dupMeetings: Array<{ meeting_id: string; live_booking_count: string }> =
    await AppDataSource.query(`
      SELECT meeting_id, COUNT(*) AS live_booking_count
      FROM room_bookings
      WHERE status IN ('pending', 'approved', 'active')
      GROUP BY meeting_id
      HAVING COUNT(*) > 1
      ORDER BY live_booking_count DESC
    `);

  console.log(
    `\n[1] Meeting có >1 room_booking đang sống cùng lúc: ${dupMeetings.length} meeting`,
  );

  if (dupMeetings.length > 0) {
    for (const row of dupMeetings) {
      console.log(`\n  meeting_id=${row.meeting_id} (${row.live_booking_count} dòng)`);
      const bookings = await AppDataSource.query(
        `
          SELECT id, booking_code, room_id, status, booking_type,
                 reserved_start_time, reserved_end_time, created_at, updated_at
          FROM room_bookings
          WHERE meeting_id = $1
          ORDER BY created_at
        `,
        [row.meeting_id],
      );
      console.table(bookings);

      const meeting = await AppDataSource.query(
        `SELECT id, meeting_code, title, status, room_id, start_time, end_time FROM meetings WHERE id = $1`,
        [row.meeting_id],
      );
      console.log('  meeting hiện tại:', meeting[0]);
    }
  }

  // 2) Đối chứng: có cặp booking nào TRÙNG THẬT giữa 2 meeting KHÁC NHAU không
  //    (double-booking thật, không phải tự đụng mình) — để phân biệt 2 loại lỗi.
  const realConflicts = await AppDataSource.query(`
    SELECT a.id AS booking_a, a.meeting_id AS meeting_a,
           b.id AS booking_b, b.meeting_id AS meeting_b,
           a.room_id,
           a.reserved_start_time AS a_start, a.reserved_end_time AS a_end,
           b.reserved_start_time AS b_start, b.reserved_end_time AS b_end
    FROM room_bookings a
    JOIN room_bookings b
      ON a.room_id = b.room_id
     AND a.meeting_id <> b.meeting_id
     AND a.id < b.id
     AND a.status IN ('pending', 'approved', 'active')
     AND b.status IN ('pending', 'approved', 'active')
     AND a.reserved_start_time < b.reserved_end_time
     AND a.reserved_end_time > b.reserved_start_time
  `);

  console.log(
    `\n[2] Double-booking THẬT (2 meeting khác nhau, cùng phòng, trùng giờ): ${realConflicts.length} cặp`,
  );
  if (realConflicts.length > 0) {
    console.table(realConflicts);
  }

  await AppDataSource.destroy();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
