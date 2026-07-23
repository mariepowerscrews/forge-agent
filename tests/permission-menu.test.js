const { showPermissionMenu, showApprovalMenu } = require('../src/permission-menu');

describe('permission-menu', () => {
  let originalStdinIsTTY;
  let originalStdoutIsTTY;

  beforeAll(() => {
    originalStdinIsTTY = process.stdin.isTTY;
    originalStdoutIsTTY = process.stdout.isTTY;
  });

  afterAll(() => {
    process.stdin.isTTY = originalStdinIsTTY;
    process.stdout.isTTY = originalStdoutIsTTY;
  });

  it('resolves once immediately when stdin.isTTY is false', async () => {
    process.stdin.isTTY = false;
    const result = await showPermissionMenu({ label: 'Test' });
    expect(result).toBe('once');
  });

  it('resolves approve immediately when stdin.isTTY is false for showApprovalMenu', async () => {
    process.stdin.isTTY = false;
    const result = await showApprovalMenu({ title: 'Test' });
    expect(result).toBe('approve');
  });

  it('resolves once immediately when stdout.isTTY is false', async () => {
    process.stdin.isTTY = true;
    process.stdout.isTTY = false;
    const result = await showPermissionMenu({ label: 'Test' });
    expect(result).toBe('once');
  });

  it('resolves approve immediately when stdout.isTTY is false for showApprovalMenu', async () => {
    process.stdin.isTTY = true;
    process.stdout.isTTY = false;
    const result = await showApprovalMenu({ title: 'Test' });
    expect(result).toBe('approve');
  });

  it('module loads without throwing', () => {
    expect(showPermissionMenu).toBeDefined();
    expect(showApprovalMenu).toBeDefined();
  });

  // Cannot test raw mode directly in Jest easily, but we tested the non-TTY fallback.
});
