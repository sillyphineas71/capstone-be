import { FromToConstraint } from './from-to.constraint.js';

describe('FromToConstraint', () => {
  const constraint = new FromToConstraint();
  const args = (object: Record<string, unknown>) =>
    ({ object }) as unknown as Parameters<FromToConstraint['validate']>[1];

  it('passes when from <= to', () => {
    const result = constraint.validate(
      'to',
      args({
        from: '2026-07-01T00:00:00.000Z',
        to: '2026-07-02T00:00:00.000Z',
      }),
    );
    expect(result).toBe(true);
  });

  it('fails when from > to', () => {
    const result = constraint.validate(
      'to',
      args({
        from: '2026-07-02T00:00:00.000Z',
        to: '2026-07-01T00:00:00.000Z',
      }),
    );
    expect(result).toBe(false);
  });

  it('passes when only from is provided', () => {
    const result = constraint.validate(
      'to',
      args({
        from: '2026-07-01T00:00:00.000Z',
        to: undefined,
      }),
    );
    expect(result).toBe(true);
  });

  it('passes when only to is provided', () => {
    const result = constraint.validate(
      'to',
      args({
        from: undefined,
        to: '2026-07-01T00:00:00.000Z',
      }),
    );
    expect(result).toBe(true);
  });

  it('passes (lenient) when either date is unparseable', () => {
    const result = constraint.validate(
      'to',
      args({
        from: 'not-a-date',
        to: '2026-07-01T00:00:00.000Z',
      }),
    );
    expect(result).toBe(true);
  });
});
