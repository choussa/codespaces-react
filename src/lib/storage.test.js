import { expect, test, vi, describe, beforeEach } from 'vitest';

let mockFrom;
let mockSupabase;
let mockIsSupabaseReady;

function makeChain(overrides = {}) {
  const chain = {};
  const methods = ['select', 'eq', 'insert', 'upsert', 'delete', 'maybeSingle', 'single', 'onConflict', 'update'];
  for (const m of methods) {
    chain[m] = vi.fn(() => chain);
  }
  for (const [key, fn] of Object.entries(overrides)) {
    chain[key] = fn;
  }
  return chain;
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();

  mockFrom = vi.fn(() => makeChain());
  mockSupabase = {
    auth: {
      getSession: vi.fn(),
    },
    from: mockFrom,
  };
  mockIsSupabaseReady = vi.fn();
});

async function loadStorage() {
  vi.resetModules();
  vi.doMock('./supabase', () => ({
    supabase: mockSupabase,
    isSupabaseReady: mockIsSupabaseReady,
  }));
  return import('./storage');
}

describe('sync guards', () => {
  test('syncProjectsToSupabase returns early when supabase not ready', async () => {
    mockIsSupabaseReady.mockReturnValue(false);
    const { syncProjectsToSupabase } = await loadStorage();
    await syncProjectsToSupabase({ test: {} });
    expect(mockSupabase.auth.getSession).not.toHaveBeenCalled();
  });

  test('syncProjectsToSupabase returns early when no user', async () => {
    mockIsSupabaseReady.mockReturnValue(true);
    mockSupabase.auth.getSession.mockResolvedValue({ data: { session: null } });
    const { syncProjectsToSupabase } = await loadStorage();
    await syncProjectsToSupabase({ test: {} });
    expect(mockFrom).not.toHaveBeenCalled();
  });

  test('syncFileToSupabase returns early when supabase not ready', async () => {
    mockIsSupabaseReady.mockReturnValue(false);
    const { syncFileToSupabase } = await loadStorage();
    await syncFileToSupabase('proj', 'f.typ', 'content');
    expect(mockSupabase.auth.getSession).not.toHaveBeenCalled();
  });

  test('syncFileAddToSupabase returns early when supabase not ready', async () => {
    mockIsSupabaseReady.mockReturnValue(false);
    const { syncFileAddToSupabase } = await loadStorage();
    await syncFileAddToSupabase('proj', 'f.typ');
    expect(mockSupabase.auth.getSession).not.toHaveBeenCalled();
  });

  test('syncFileDeleteToSupabase returns early when supabase not ready', async () => {
    mockIsSupabaseReady.mockReturnValue(false);
    const { syncFileDeleteToSupabase } = await loadStorage();
    await syncFileDeleteToSupabase('proj', 'f.typ');
    expect(mockSupabase.auth.getSession).not.toHaveBeenCalled();
  });

  test('syncFileRenameToSupabase returns early when supabase not ready', async () => {
    mockIsSupabaseReady.mockReturnValue(false);
    const { syncFileRenameToSupabase } = await loadStorage();
    await syncFileRenameToSupabase('proj', 'old.typ', 'new.typ');
    expect(mockSupabase.auth.getSession).not.toHaveBeenCalled();
  });

  test('syncProjectDeleteToSupabase returns early when supabase not ready', async () => {
    mockIsSupabaseReady.mockReturnValue(false);
    const { syncProjectDeleteToSupabase } = await loadStorage();
    await syncProjectDeleteToSupabase('proj');
    expect(mockSupabase.auth.getSession).not.toHaveBeenCalled();
  });

  test('loadProjectsFromSupabase returns early when supabase not ready', async () => {
    mockIsSupabaseReady.mockReturnValue(false);
    const { loadProjectsFromSupabase } = await loadStorage();
    const result = await loadProjectsFromSupabase();
    expect(result).toBeNull();
  });
});

describe('syncProjectsToSupabase', () => {
  test('syncs multiple projects with files', async () => {
    mockIsSupabaseReady.mockReturnValue(true);
    mockSupabase.auth.getSession.mockResolvedValue({
      data: { session: { user: { id: 'user-1' } } },
    });

    const insertedFiles = [];

    mockFrom.mockImplementation((table) => {
      if (table === 'projects') {
        return makeChain({
          maybeSingle: vi.fn().mockResolvedValue({ data: null }),
          insert: vi.fn((row) => makeChain({
            select: vi.fn(() => makeChain({
              single: vi.fn().mockResolvedValue({ data: { id: `proj-${row.name}` } }),
            })),
          })),
          update: vi.fn(() => makeChain({
            eq: vi.fn().mockResolvedValue({ data: null }),
          })),
        });
      }
      if (table === 'project_files') {
        return makeChain({
          upsert: vi.fn((row) => {
            insertedFiles.push(row);
            return makeChain({
              onConflict: vi.fn().mockResolvedValue({ data: null }),
            });
          }),
        });
      }
      return makeChain();
    });

    const { syncProjectsToSupabase } = await loadStorage();
    await syncProjectsToSupabase({
      'my-project': {
        name: 'my-project',
        location: 'dark',
        currentFile: 'main.typ',
        settings: { fontSize: 14 },
        files: { 'main.typ': 'hello', 'lib.typ': 'world' },
      },
    });

    expect(mockFrom).toHaveBeenCalledWith('projects');
    expect(mockFrom).toHaveBeenCalledWith('project_files');
    expect(insertedFiles.length).toBe(2);
  });

  test('handles error gracefully', async () => {
    mockIsSupabaseReady.mockReturnValue(true);
    mockSupabase.auth.getSession.mockRejectedValue(new Error('network error'));

    const { syncProjectsToSupabase } = await loadStorage();
    await expect(syncProjectsToSupabase({ 'p': {} })).resolves.toBeUndefined();
  });
});

describe('syncFileToSupabase', () => {
  test('upserts file and updates project', async () => {
    mockIsSupabaseReady.mockReturnValue(true);
    mockSupabase.auth.getSession.mockResolvedValue({
      data: { session: { user: { id: 'user-1' } } },
    });

    let upsertCalled = false;
    let updateCalled = false;

    mockFrom.mockImplementation((table) => {
      if (table === 'projects') {
        return makeChain({
          maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'proj-1' } }),
          update: vi.fn(() => {
            updateCalled = true;
            return makeChain({
              eq: vi.fn().mockResolvedValue({ data: null }),
            });
          }),
        });
      }
      if (table === 'project_files') {
        return makeChain({
          upsert: vi.fn(() => {
            upsertCalled = true;
            return makeChain({
              onConflict: vi.fn().mockResolvedValue({ data: null }),
            });
          }),
        });
      }
      return makeChain();
    });

    const { syncFileToSupabase } = await loadStorage();
    await syncFileToSupabase('my-project', 'main.typ', 'updated content');
    expect(upsertCalled).toBe(true);
    expect(updateCalled).toBe(true);
  });
});

describe('syncFileAddToSupabase', () => {
  test('inserts file and updates project current_file', async () => {
    mockIsSupabaseReady.mockReturnValue(true);
    mockSupabase.auth.getSession.mockResolvedValue({
      data: { session: { user: { id: 'user-1' } } },
    });

    let insertCalled = false;
    let updateCalled = false;

    mockFrom.mockImplementation((table) => {
      if (table === 'projects') {
        return makeChain({
          maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'proj-1' } }),
          update: vi.fn((updates) => {
            expect(updates.current_file).toBe('new.typ');
            updateCalled = true;
            return makeChain({
              eq: vi.fn().mockResolvedValue({ data: null }),
            });
          }),
        });
      }
      if (table === 'project_files') {
        return makeChain({
          insert: vi.fn(() => {
            insertCalled = true;
            return makeChain();
          }),
        });
      }
      return makeChain();
    });

    const { syncFileAddToSupabase } = await loadStorage();
    await syncFileAddToSupabase('my-project', 'new.typ');
    expect(insertCalled).toBe(true);
    expect(updateCalled).toBe(true);
  });
});

describe('syncFileDeleteToSupabase', () => {
  test('deletes file and updates project', async () => {
    mockIsSupabaseReady.mockReturnValue(true);
    mockSupabase.auth.getSession.mockResolvedValue({
      data: { session: { user: { id: 'user-1' } } },
    });

    let deleteCalled = false;
    let updateCalled = false;

    mockFrom.mockImplementation((table) => {
      if (table === 'projects') {
        return makeChain({
          maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'proj-1' } }),
          update: vi.fn(() => {
            updateCalled = true;
            return makeChain({
              eq: vi.fn().mockResolvedValue({ data: null }),
            });
          }),
        });
      }
      if (table === 'project_files') {
        return makeChain({
          delete: vi.fn(() => {
            deleteCalled = true;
            return makeChain({
              eq: vi.fn(() => makeChain({
                eq: vi.fn().mockResolvedValue({ data: null }),
              })),
            });
          }),
        });
      }
      return makeChain();
    });

    const { syncFileDeleteToSupabase } = await loadStorage();
    await syncFileDeleteToSupabase('my-project', 'old.typ');
    expect(deleteCalled).toBe(true);
    expect(updateCalled).toBe(true);
  });
});

describe('syncFileRenameToSupabase', () => {
  test('reads old file, deletes, inserts with new name', async () => {
    mockIsSupabaseReady.mockReturnValue(true);
    mockSupabase.auth.getSession.mockResolvedValue({
      data: { session: { user: { id: 'user-1' } } },
    });

    let deleteCalled = false;
    let insertCalled = false;
    let updateCalled = false;

    mockFrom.mockImplementation((table) => {
      if (table === 'projects') {
        return makeChain({
          maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'proj-1' } }),
          update: vi.fn(() => {
            updateCalled = true;
            return makeChain({
              eq: vi.fn().mockResolvedValue({ data: null }),
            });
          }),
        });
      }
      if (table === 'project_files') {
        const base = makeChain();
        return {
          ...base,
          select: vi.fn(() => makeChain({
            eq: vi.fn(() => makeChain({
              maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'file-1', content: 'hello' } }),
            })),
          })),
          delete: vi.fn(() => {
            deleteCalled = true;
            return makeChain({
              eq: vi.fn().mockResolvedValue({ data: null }),
            });
          }),
          insert: vi.fn((row) => {
            expect(row.name).toBe('new.typ');
            expect(row.content).toBe('hello');
            insertCalled = true;
          }),
        };
      }
      return makeChain();
    });

    const { syncFileRenameToSupabase } = await loadStorage();
    await syncFileRenameToSupabase('my-project', 'old.typ', 'new.typ');
    expect(deleteCalled).toBe(true);
    expect(insertCalled).toBe(true);
    expect(updateCalled).toBe(true);
  });

  test('returns early if old file not found', async () => {
    mockIsSupabaseReady.mockReturnValue(true);
    mockSupabase.auth.getSession.mockResolvedValue({
      data: { session: { user: { id: 'user-1' } } },
    });

    let insertCalled = false;
    let deleteCalled = false;

    mockFrom.mockImplementation((table) => {
      if (table === 'projects') {
        return makeChain({
          maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'proj-1' } }),
        });
      }
      if (table === 'project_files') {
        return makeChain({
          select: vi.fn(() => makeChain({
            eq: vi.fn(() => makeChain({
              maybeSingle: vi.fn().mockResolvedValue({ data: null }),
            })),
          })),
          insert: vi.fn(() => { insertCalled = true; }),
          delete: vi.fn(() => { deleteCalled = true; }),
        });
      }
      return makeChain();
    });

    const { syncFileRenameToSupabase } = await loadStorage();
    await syncFileRenameToSupabase('my-project', 'old.typ', 'new.typ');
    expect(deleteCalled).toBe(false);
    expect(insertCalled).toBe(false);
  });
});

describe('syncProjectDeleteToSupabase', () => {
  test('deletes project by user_id and name', async () => {
    mockIsSupabaseReady.mockReturnValue(true);
    mockSupabase.auth.getSession.mockResolvedValue({
      data: { session: { user: { id: 'user-1' } } },
    });

    let deleteCalled = false;

    mockFrom.mockImplementation((table) => {
      if (table === 'projects') {
        return makeChain({
          delete: vi.fn(() => {
            deleteCalled = true;
            return makeChain({
              eq: vi.fn(() => makeChain({
                eq: vi.fn().mockResolvedValue({ data: null }),
              })),
            });
          }),
        });
      }
      return makeChain();
    });

    const { syncProjectDeleteToSupabase } = await loadStorage();
    await syncProjectDeleteToSupabase('my-project');
    expect(deleteCalled).toBe(true);
  });
});

describe('loadProjectsFromSupabase', () => {
  test('loads projects and their files', async () => {
    mockIsSupabaseReady.mockReturnValue(true);
    mockSupabase.auth.getSession.mockResolvedValue({
      data: { session: { user: { id: 'user-1' } } },
    });

    mockFrom.mockImplementation((table) => {
      if (table === 'projects') {
        return makeChain({
          eq: vi.fn().mockResolvedValue({
            data: [
              { id: 'p1', name: 'alpha', location: 'dark', current_file: 'm.typ', created_at: '2024-01-01', updated_at: '2024-01-02', settings: {} },
            ],
          }),
        });
      }
      if (table === 'project_files') {
        return makeChain({
          eq: vi.fn().mockResolvedValue({
            data: [
              { name: 'm.typ', content: 'hello' },
              { name: 'lib.typ', content: 'world' },
            ],
          }),
        });
      }
      return makeChain();
    });

    const { loadProjectsFromSupabase } = await loadStorage();
    const result = await loadProjectsFromSupabase();

    expect(result).not.toBeNull();
    expect(result.alpha).toBeDefined();
    expect(result.alpha.files['m.typ']).toBe('hello');
    expect(result.alpha.files['lib.typ']).toBe('world');
    expect(result.alpha.location).toBe('dark');
  });

  test('returns null when no projects found', async () => {
    mockIsSupabaseReady.mockReturnValue(true);
    mockSupabase.auth.getSession.mockResolvedValue({
      data: { session: { user: { id: 'user-1' } } },
    });

    mockFrom.mockImplementation(() => makeChain({
      eq: vi.fn().mockResolvedValue({ data: [] }),
    }));

    const { loadProjectsFromSupabase } = await loadStorage();
    const result = await loadProjectsFromSupabase();
    expect(result).toBeNull();
  });
});
