import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Seed 14 user demo, rai deu 6 phong ban (20260720000001-SeedDemoDepartments.ts),
 * dung de dang nhap/demo ngay: 1 SYSTEM_ADMIN, 2 BUSINESS_ADMIN, 3 MANAGER, 8 EMPLOYEE.
 * Gan role thuc su nam o migration ke tiep (20260720000004-SeedDemoUserRoles.ts).
 *
 * Mat khau demo CHUNG cho toan bo user: "Abcd1234@" (bcrypt, salt rounds = 10, khop
 * BCRYPT_SALT_ROUNDS mac dinh cua du an — xem src/modules/accounts/services/users.service.ts).
 * Hash duoi day duoc tao bang chinh thu vien bcryptjs cua du an, KHONG phai gia tri bia.
 *
 * Sau khi tao xong, UPDATE lai departments.manager_user_id cho 4 phong ban co manager
 * ro rang (BOD/IT/HR/SALES); ADM va FAC de trong (khong co manager rieng trong demo data).
 */
export class SeedDemoUsers20260720000003 implements MigrationInterface {
  name = 'SeedDemoUsers20260720000003';

  // bcrypt.hash('Abcd1234@', bcrypt.genSaltSync(10)) — xac thuc lai bang bcrypt.compare truoc khi dung.
  private readonly demoPasswordHash =
    '$2b$10$szGAzI6OAO0nxSI4OSsCuuwQVvan0AJW2XjzvMlHb2VeNGgBusgm6';

  private readonly managers: Array<{
    username: string;
    email: string;
    employeeCode: string;
    fullName: string;
    positionTitle: string;
    deptCode: string;
    roleForNote: string;
  }> = [
    {
      username: 'sysadmin',
      email: 'sysadmin@meetingsys.vn',
      employeeCode: 'EMP001',
      fullName: 'Tran Quoc Admin',
      positionTitle: 'System Administrator',
      deptCode: 'BOD',
      roleForNote: 'SYSTEM_ADMIN',
    },
    {
      username: 'bizadmin.it',
      email: 'bizadmin.it@meetingsys.vn',
      employeeCode: 'EMP002',
      fullName: 'Le Thi Van Anh',
      positionTitle: 'Business Admin - IT',
      deptCode: 'IT',
      roleForNote: 'BUSINESS_ADMIN',
    },
    {
      username: 'bizadmin.hr',
      email: 'bizadmin.hr@meetingsys.vn',
      employeeCode: 'EMP003',
      fullName: 'Pham Minh Duc',
      positionTitle: 'Business Admin - HR',
      deptCode: 'HR',
      roleForNote: 'BUSINESS_ADMIN',
    },
    {
      username: 'manager.it',
      email: 'manager.it@meetingsys.vn',
      employeeCode: 'EMP004',
      fullName: 'Nguyen Hoang Nam',
      positionTitle: 'IT Manager',
      deptCode: 'IT',
      roleForNote: 'MANAGER',
    },
    {
      username: 'manager.hr',
      email: 'manager.hr@meetingsys.vn',
      employeeCode: 'EMP005',
      fullName: 'Do Thi Hong',
      positionTitle: 'HR Manager',
      deptCode: 'HR',
      roleForNote: 'MANAGER',
    },
    {
      username: 'manager.sales',
      email: 'manager.sales@meetingsys.vn',
      employeeCode: 'EMP006',
      fullName: 'Vu Anh Tuan',
      positionTitle: 'Sales Manager',
      deptCode: 'SALES',
      roleForNote: 'MANAGER',
    },
  ];

  private readonly employees: Array<{
    username: string;
    email: string;
    employeeCode: string;
    fullName: string;
    positionTitle: string;
    deptCode: string;
    managerUsername: string | null;
  }> = [
    {
      username: 'emp.it1',
      email: 'emp.it1@meetingsys.vn',
      employeeCode: 'EMP007',
      fullName: 'Bui Van Long',
      positionTitle: 'Software Engineer',
      deptCode: 'IT',
      managerUsername: 'manager.it',
    },
    {
      username: 'emp.it2',
      email: 'emp.it2@meetingsys.vn',
      employeeCode: 'EMP008',
      fullName: 'Ngo Thi Lan',
      positionTitle: 'QA Engineer',
      deptCode: 'IT',
      managerUsername: 'manager.it',
    },
    {
      username: 'emp.hr1',
      email: 'emp.hr1@meetingsys.vn',
      employeeCode: 'EMP009',
      fullName: 'Hoang Thi Mai',
      positionTitle: 'HR Executive',
      deptCode: 'HR',
      managerUsername: 'manager.hr',
    },
    {
      username: 'emp.hr2',
      email: 'emp.hr2@meetingsys.vn',
      employeeCode: 'EMP010',
      fullName: 'Dang Van Kien',
      positionTitle: 'HR Executive',
      deptCode: 'HR',
      managerUsername: 'manager.hr',
    },
    {
      username: 'emp.sales1',
      email: 'emp.sales1@meetingsys.vn',
      employeeCode: 'EMP011',
      fullName: 'Trinh Thi Thu',
      positionTitle: 'Sales Executive',
      deptCode: 'SALES',
      managerUsername: 'manager.sales',
    },
    {
      username: 'emp.sales2',
      email: 'emp.sales2@meetingsys.vn',
      employeeCode: 'EMP012',
      fullName: 'Phan Van Dat',
      positionTitle: 'Sales Executive',
      deptCode: 'SALES',
      managerUsername: 'manager.sales',
    },
    {
      username: 'emp.admin1',
      email: 'emp.admin1@meetingsys.vn',
      employeeCode: 'EMP013',
      fullName: 'Ly Thi Ngoc',
      positionTitle: 'Le tan',
      deptCode: 'ADM',
      managerUsername: null,
    },
    {
      username: 'emp.facility1',
      email: 'emp.facility1@meetingsys.vn',
      employeeCode: 'EMP014',
      fullName: 'Dinh Van Hung',
      positionTitle: 'Nhan vien co so vat chat',
      deptCode: 'FAC',
      managerUsername: null,
    },
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    const userIdByUsername = new Map<string, string>();

    for (const m of this.managers) {
      await this.insertUser(
        queryRunner,
        m.username,
        m.email,
        m.employeeCode,
        m.fullName,
        m.positionTitle,
        m.deptCode,
        null,
      );
    }
    for (const m of this.managers) {
      const id = await this.getUserId(queryRunner, m.username);
      if (id) userIdByUsername.set(m.username, id);
    }

    for (const e of this.employees) {
      const managerId = e.managerUsername
        ? (userIdByUsername.get(e.managerUsername) ?? null)
        : null;
      await this.insertUser(
        queryRunner,
        e.username,
        e.email,
        e.employeeCode,
        e.fullName,
        e.positionTitle,
        e.deptCode,
        managerId,
      );
    }

    // Gan manager_user_id cho 4 phong ban co manager ro rang.
    const deptManagerPairs: Array<[string, string]> = [
      ['BOD', 'sysadmin'],
      ['IT', 'manager.it'],
      ['HR', 'manager.hr'],
      ['SALES', 'manager.sales'],
    ];
    for (const [deptCode, username] of deptManagerPairs) {
      const managerId =
        userIdByUsername.get(username) ??
        (await this.getUserId(queryRunner, username));
      if (!managerId) continue;
      await queryRunner.query(
        `UPDATE departments SET manager_user_id = $1 WHERE department_code = $2 AND manager_user_id IS NULL;`,
        [managerId, deptCode],
      );
    }
  }

  private async insertUser(
    queryRunner: QueryRunner,
    username: string,
    email: string,
    employeeCode: string,
    fullName: string,
    positionTitle: string,
    deptCode: string,
    directManagerId: string | null,
  ): Promise<void> {
    await queryRunner.query(
      `INSERT INTO users (
         employee_code, username, email, password_hash, full_name, position_title,
         department_id, direct_manager_id, employment_status, account_status,
         must_change_password
       )
       SELECT $1::varchar, $2::varchar, $3::varchar, $4::varchar, $5::varchar, $6::varchar,
              (SELECT id FROM departments WHERE department_code = $7), $8::uuid,
              'active', 'active', false
       WHERE NOT EXISTS (SELECT 1 FROM users WHERE lower(username) = lower($2) OR lower(email) = lower($3));`,
      [
        employeeCode,
        username,
        email,
        this.demoPasswordHash,
        fullName,
        positionTitle,
        deptCode,
        directManagerId,
      ],
    );
  }

  private async getUserId(
    queryRunner: QueryRunner,
    username: string,
  ): Promise<string | null> {
    const row = (await queryRunner.query(
      `SELECT id FROM users WHERE lower(username) = lower($1);`,
      [username],
    )) as Array<{ id: string }>;
    return row[0]?.id ?? null;
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const usernames = [
      ...this.managers.map((m) => m.username),
      ...this.employees.map((e) => e.username),
    ];
    await queryRunner.query(
      `UPDATE departments SET manager_user_id = NULL
       WHERE manager_user_id IN (SELECT id FROM users WHERE lower(username) = ANY($1));`,
      [usernames.map((u) => u.toLowerCase())],
    );
    await queryRunner.query(
      `UPDATE users SET direct_manager_id = NULL WHERE lower(username) = ANY($1);`,
      [usernames.map((u) => u.toLowerCase())],
    );
    await queryRunner.query(
      `DELETE FROM user_roles WHERE user_id IN (SELECT id FROM users WHERE lower(username) = ANY($1));`,
      [usernames.map((u) => u.toLowerCase())],
    );
    await queryRunner.query(
      `DELETE FROM users WHERE lower(username) = ANY($1);`,
      [usernames.map((u) => u.toLowerCase())],
    );
  }
}
