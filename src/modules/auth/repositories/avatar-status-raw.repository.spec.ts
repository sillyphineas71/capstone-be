import { AvatarStatusRawRepository } from './avatar-status-raw.repository';

/**
 * ACCT-AVATAR-SUBMIT-001 — Unit test cho AvatarStatusRawRepository (SB-01).
 */
describe('AvatarStatusRawRepository', () => {
  let repo: AvatarStatusRawRepository;
  let dataSource: { query: jest.Mock };

  beforeEach(() => {
    dataSource = { query: jest.fn() };
    repo = new AvatarStatusRawRepository(dataSource as never);
  });

  it('query face_profiles theo user_id chưa soft-delete, parameterized', async () => {
    dataSource.query.mockResolvedValue([
      { status: 'active', last_updated_at: null, enrolled_at: null },
    ]);

    const rows = await repo.getFaceProfileRows('u1');

    const [sqlArg, paramsArg] = dataSource.query.mock.calls[0] as [
      string,
      unknown[],
    ];
    expect(sqlArg).toContain('FROM face_profiles');
    expect(sqlArg).toContain('user_id = $1');
    expect(sqlArg).toContain('deleted_at IS NULL');
    expect(paramsArg).toEqual(['u1']);
    expect(rows).toEqual([
      { status: 'active', lastUpdatedAt: null, enrolledAt: null },
    ]);
  });

  it('map snake_case → camelCase và default null', async () => {
    const now = new Date();
    dataSource.query.mockResolvedValue([
      { status: 'pending_review', last_updated_at: now, enrolled_at: now },
    ]);

    const rows = await repo.getFaceProfileRows('u1');
    expect(rows[0]).toEqual({
      status: 'pending_review',
      lastUpdatedAt: now,
      enrolledAt: now,
    });
  });

  it('không có row → mảng rỗng', async () => {
    dataSource.query.mockResolvedValue([]);
    expect(await repo.getFaceProfileRows('u1')).toEqual([]);
  });
});
