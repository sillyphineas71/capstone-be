import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * SAVP Zone scope — them `latitude`/`longitude` (toa do GPS) vao bang `zones`.
 *
 * Phuc vu HAI cho: dashboard + heatmap khuon vien (UC-126/UC-120) va so do lap dat camera
 * (UC-95). Mot quyet dinh, hai cho dung.
 *
 * ⚠ DA CHOT: toa do **GPS**, KHONG phai toa do pixel tren so do mat bang. Ly do: phuong an
 * so do can ban ve mat bang tung tang ma nhom KHONG co; toa do GPS doc duoc tu ban do trong
 * vai phut va FE dung bang thu vien ban do san co.
 *
 * ⚠ Day la migration SCHEMA thu hai (sau 20260722000008) — ngoai le co chu dich, ADD-ONLY:
 * chi THEM 2 cot nullable, KHONG default, KHONG dung cot/du lieu/index nao khac.
 *
 * numeric(9,6): du cho vi do (-90..90) / kinh do (-180..180) voi 6 chu so thap phan
 * (~0.11 m) — thua do chinh xac cho vi tri cong/toa nha.
 *
 * ⚠ KHOANG TRONG sau migration nay: CHUA co endpoint nao ghi duoc toa do (UpdateZoneDto
 * khong co 2 field nay, toZoneResponse khong tra ra). Toa do se o NULL cho toi khi: dien
 * bang SQL tay (du cho demo) HOAC lam mot viec rieng them latitude/longitude vao luong
 * cap nhat zone (UC-91).
 */
export class AddZoneCoordinates20260722000010 implements MigrationInterface {
  name = 'AddZoneCoordinates20260722000010';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "zones" ADD COLUMN IF NOT EXISTS "latitude" numeric(9,6)`,
    );
    await queryRunner.query(
      `ALTER TABLE "zones" ADD COLUMN IF NOT EXISTS "longitude" numeric(9,6)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "zones" DROP COLUMN "longitude"`);
    await queryRunner.query(`ALTER TABLE "zones" DROP COLUMN "latitude"`);
  }
}
