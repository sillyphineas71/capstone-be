import * as fs from 'fs';
import * as path from 'path';
import { AppDataSource } from '../src/database/data-source.js';

/**
 * Runner script nạp clean_demo_seed.sql vào PostgreSQL.
 * Thực thi: npx tsx scripts/seed-clean-demo.ts
 */
async function seedCleanDemo(): Promise<void> {
  console.log('🔄 Đang kết nối tới PostgreSQL Database...');
  await AppDataSource.initialize();

  const sqlFilePath = path.join(__dirname, '../clean_demo_seed.sql');
  if (!fs.existsSync(sqlFilePath)) {
    throw new Error(`❌ Không tìm thấy file SQL tại: ${sqlFilePath}`);
  }

  console.log('🧹 Đang thực thi nạp Dữ liệu Sạch Demo (clean_demo_seed.sql)...');
  const sql = fs.readFileSync(sqlFilePath, 'utf-8');

  try {
    await AppDataSource.query(sql);
    console.log('✅ NẠP DỮ LIỆU SẠCH DEMO THÀNH CÔNG!');
    console.log('----------------------------------------------------');
    console.log('📌 Danh sách tài khoản demo (Mật khẩu chung: Abcd1234@):');
    console.log(' - System Admin:     sysadmin@meetingsys.vn (Trần Quốc Admin)');
    console.log(' - CEO / BOD Admin:  hung.nguyen@meetingsys.vn (Nguyễn Văn Hùng)');
    console.log(' - IT Manager:       tuan.le@meetingsys.vn (Lê Minh Tuấn)');
    console.log(' - HR Manager:       ha.vo@meetingsys.vn (Võ Thị Thu Hà)');
    console.log(' - Sales Manager:    bao.trinh@meetingsys.vn (Trịnh Quốc Bảo)');
    console.log(' - Facility Manager: nam.ngo@meetingsys.vn (Ngô Văn Nam)');
    console.log(' - IT Staff 1:       anh.pham@meetingsys.vn (Phạm Đức Anh)');
    console.log(' - Security Guard:   thang.bui@meetingsys.vn (Bùi Văn Thắng)');
    console.log('----------------------------------------------------');
  } catch (error) {
    console.error('❌ Lỗi khi thực thi clean_demo_seed.sql:', error);
    throw error;
  } finally {
    await AppDataSource.destroy();
  }
}

seedCleanDemo().catch((err) => {
  console.error(err);
  process.exit(1);
});
