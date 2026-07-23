const { PermissionStore, isReadOnly, getCategory } = require('../src/permission-store');
const os = require('os');
const path = require('path');
const fs = require('fs');

describe('permission-store', () => {
  let tmpDir;
  
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-agent-test-'));
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  it('PermissionStore instantiates without throwing for a nonexistent directory', () => {
    expect(() => {
      new PermissionStore(path.join(tmpDir, 'nonexistent'));
    }).not.toThrow();
  });

  it('isPreApproved returns false initially', () => {
    const store = new PermissionStore(tmpDir);
    expect(store.isPreApproved('file_write')).toBe(false);
  });

  it('record(\'saved\') persists to .forge-permissions.json', () => {
    const store = new PermissionStore(tmpDir);
    store.record('file_write', 'saved');
    
    const filePath = path.join(tmpDir, '.forge-permissions.json');
    expect(fs.existsSync(filePath)).toBe(true);
    const content = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    expect(content.alwaysAllow).toContain('file_write');
  });

  it('a new PermissionStore instance for the same dir loads the saved category', () => {
    const store1 = new PermissionStore(tmpDir);
    store1.record('file_write', 'saved');
    
    const store2 = new PermissionStore(tmpDir);
    expect(store2.isPreApproved('file_write')).toBe(true);
  });

  it('record(null) as once equivalent does not persist anything', () => {
    const store = new PermissionStore(tmpDir);
    store.record('file_write', null);
    
    expect(store.isPreApproved('file_write')).toBe(false);
    expect(fs.existsSync(path.join(tmpDir, '.forge-permissions.json'))).toBe(false);
  });
  
  it('record(\'session\') approves for session but does not persist to file', () => {
    const store = new PermissionStore(tmpDir);
    store.record('file_write', 'session');
    
    expect(store.isPreApproved('file_write')).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, '.forge-permissions.json'))).toBe(false);
  });

  it('isReadOnly returns true for read_file, list_directory, git_status, show_info', () => {
    expect(isReadOnly('read_file')).toBe(true);
    expect(isReadOnly('list_directory')).toBe(true);
    expect(isReadOnly('git_status')).toBe(true);
    expect(isReadOnly('show_info')).toBe(true);
  });

  it('isReadOnly returns false for write_file, run_command, delete_file', () => {
    expect(isReadOnly('write_file')).toBe(false);
    expect(isReadOnly('run_command')).toBe(false);
    expect(isReadOnly('delete_file')).toBe(false);
  });

  it('getCategory returns file_write for write_file', () => {
    expect(getCategory('write_file')).toBe('file_write');
  });

  it('getCategory returns shell_exec for run_command', () => {
    expect(getCategory('run_command')).toBe('shell_exec');
  });

  it('getCategory returns other for show_info (not present in TOOL_CATEGORIES)', () => {
    expect(getCategory('show_info')).toBe('other');
  });

  it('constructor never throws on corrupt .forge-permissions.json content', () => {
    fs.writeFileSync(path.join(tmpDir, '.forge-permissions.json'), '{ invalid json ');
    expect(() => {
      const store = new PermissionStore(tmpDir);
      expect(store.isPreApproved('file_write')).toBe(false);
    }).not.toThrow();
  });
});
