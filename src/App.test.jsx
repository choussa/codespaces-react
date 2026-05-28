import { expect, test, vi, describe, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';
import DashboardView from './components/DashboardView';

// Mock heavy dependencies that don't work in jsdom
vi.mock('@replit/codemirror-vim', () => ({ vim: () => [] }));
vi.mock('codemirror', () => {
  function makeDocState(text) {
    const doc = String(text || '');
    return {
      doc: {
        length: doc.length,
        toString: () => doc,
        line: (lineNumber) => {
          const lines = doc.split('\n');
          const safeLine = Math.max(1, Math.min(lineNumber, lines.length));
          let from = 0;
          for (let i = 0; i < safeLine - 1; i++) from += lines[i].length + 1;
          const to = from + (lines[safeLine - 1]?.length || 0);
          return { from, to, number: safeLine };
        },
        lineAt: (pos) => {
          const safePos = Math.max(0, Math.min(pos, doc.length));
          const before = doc.slice(0, safePos);
          const lineNumber = before.split('\n').length;
          const start = before.lastIndexOf('\n') + 1;
          return { number: lineNumber, from: start };
        },
      },
      selection: { main: { from: 0, to: 0, head: 0 } },
      sliceDoc: (from, to) => doc.slice(from, to),
    };
  }

  class EditorView {
    static theme() { return []; }
    static updateListener = { of: () => [] };

    constructor({ doc = '', parent }) {
      this.parent = parent;
      this.state = makeDocState(doc);
      if (parent) {
        const node = document.createElement('div');
        node.className = 'cm-editor';
        parent.appendChild(node);
      }
    }

    dispatch(transaction) {
      if (transaction?.changes) {
        const { from = 0, to = 0, insert = '' } = transaction.changes;
        const current = this.state.doc.toString();
        const next = current.slice(0, from) + insert + current.slice(to);
        this.state = makeDocState(next);
      }
      if (transaction?.selection) {
        const anchor = transaction.selection.anchor ?? 0;
        this.state.selection = { main: { from: anchor, to: anchor, head: anchor } };
      }
    }

    focus() {}
    destroy() { if (this.parent) this.parent.innerHTML = ''; }
  }

  return { EditorView, basicSetup: [] };
});
vi.mock('@codemirror/state', () => ({ Compartment: vi.fn(() => ({ of: () => [], reconfigure: () => [] })) }));
vi.mock('@codemirror/lang-markdown', () => ({ markdown: () => [] }));
vi.mock('@codemirror/theme-one-dark', () => ({ oneDark: [] }));
vi.mock('@codemirror/view', () => ({ lineNumbers: () => [], keymap: { of: () => [] } }));
vi.mock('@codemirror/autocomplete', () => ({ autocompletion: () => [], closeBrackets: () => [] }));
vi.mock('@codemirror/language', () => ({ indentOnInput: () => [] }));
vi.mock('./lib/supabase', () => ({ supabase: null, isSupabaseReady: () => false }));
vi.mock('@myriaddreamin/typst.ts', () => ({
  $typst: {
    setCompilerInitOptions: vi.fn(),
    setRendererInitOptions: vi.fn(),
    svg: vi.fn().mockResolvedValue('<svg></svg>'),
    pdf: vi.fn().mockResolvedValue(new ArrayBuffer(0)),
  },
}));

// Mock localStorage
const localStorageMock = (() => {
  let store = {};
  return {
    getItem: vi.fn(key => store[key] ?? null),
    setItem: vi.fn((key, value) => { store[key] = value; }),
    removeItem: vi.fn(key => { delete store[key]; }),
    clear: vi.fn(() => { store = {}; }),
    get length() { return Object.keys(store).length; },
    key: vi.fn(i => Object.keys(store)[i]),
  };
})();
Object.defineProperty(window, 'localStorage', { value: localStorageMock });

// Mock URL methods
window.URL.createObjectURL = vi.fn(() => 'blob:mock');
window.URL.revokeObjectURL = vi.fn();

// Helpers
function getProjects() {
  try { return JSON.parse(localStorage.getItem('typst-projects')) || {}; } catch { return {}; }
}

function setProjects(p) {
  localStorage.setItem('typst-projects', JSON.stringify(p));
}

// ─── outline extraction ──────────────────────────────────────

function extractOutline(source) {
  if (!source) return [];
  const lines = source.split('\n');
  const headings = [];
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/^(={1,6})\s+(.+)/);
    if (match) {
      headings.push({ level: match[1].length, text: match[2], line: i + 1 });
    }
  }
  return headings;
}

function wordCount(source) {
  return source?.trim() ? source.split(/\s+/).length : 0;
}

function searchFile(code, query) {
  if (!query.trim()) return [];
  const lines = code.split('\n');
  const results = [];
  const lower = query.toLowerCase();
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].toLowerCase().includes(lower)) {
      results.push({ line: i + 1, text: lines[i] });
    }
  }
  return results;
}

describe('outline extraction', () => {
  test('extracts headings of different levels', () => {
    const src = '= Title\n== Section\n=== Subsection\nNormal text\n== Another';
    const headings = extractOutline(src);
    expect(headings).toHaveLength(4);
    expect(headings[0]).toEqual({ level: 1, text: 'Title', line: 1 });
    expect(headings[1]).toEqual({ level: 2, text: 'Section', line: 2 });
    expect(headings[2]).toEqual({ level: 3, text: 'Subsection', line: 3 });
    expect(headings[3]).toEqual({ level: 2, text: 'Another', line: 5 });
  });

  test('returns empty array for no headings', () => {
    expect(extractOutline('Plain text')).toEqual([]);
  });

  test('returns empty array for empty input', () => {
    expect(extractOutline('')).toEqual([]);
  });
});

describe('word count', () => {
  test('counts words correctly', () => {
    expect(wordCount('hello world')).toBe(2);
  });

  test('returns 0 for empty string', () => {
    expect(wordCount('')).toBe(0);
  });

  test('returns 0 for whitespace', () => {
    expect(wordCount('   ')).toBe(0);
  });
});

describe('in-file search', () => {
  test('finds matching lines', () => {
    const code = 'hello world\nfoo bar\nhello again';
    const results = searchFile(code, 'hello');
    expect(results).toHaveLength(2);
    expect(results[0].line).toBe(1);
    expect(results[1].line).toBe(3);
  });

  test('returns empty for no matches', () => {
    expect(searchFile('abc', 'xyz')).toEqual([]);
  });

  test('returns empty for empty query', () => {
    expect(searchFile('abc', '')).toEqual([]);
  });

  test('is case insensitive', () => {
    const results = searchFile('Hello World', 'hello');
    expect(results).toHaveLength(1);
  });
});

describe('project CRUD', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  test('creates a project in localStorage', () => {
    const projects = {};
    const name = 'test-project';
    projects[name] = {
      name,
      files: { 'main.typ': 'test content' },
      currentFile: 'main.typ',
      modified: new Date().toLocaleDateString(),
      settings: {},
    };
    setProjects(projects);
    expect(getProjects()[name]).toBeDefined();
    expect(getProjects()[name].files['main.typ']).toBe('test content');
  });

  test('deletes a project from localStorage', () => {
    const projects = {
      'p1': { name: 'p1', files: {}, currentFile: 'main.typ', modified: 'today', settings: {} },
      'p2': { name: 'p2', files: {}, currentFile: 'main.typ', modified: 'today', settings: {} },
    };
    setProjects(projects);
    delete projects['p1'];
    setProjects(projects);
    expect(getProjects()['p1']).toBeUndefined();
    expect(getProjects()['p2']).toBeDefined();
  });

  test('adds and deletes files within a project', () => {
    const name = 'multi';
    const projects = {
      [name]: { name, files: { 'main.typ': 'hello' }, currentFile: 'main.typ', modified: 'today', settings: {} },
    };
    setProjects(projects);

    const p = getProjects()[name];
    p.files['extra.typ'] = '';
    p.currentFile = 'extra.typ';
    setProjects({ [name]: p });

    expect(Object.keys(getProjects()[name].files)).toHaveLength(2);

    const p2 = getProjects()[name];
    delete p2.files['extra.typ'];
    setProjects({ [name]: p2 });
    expect(Object.keys(getProjects()[name].files)).toHaveLength(1);
  });

  test('renames a file within a project', () => {
    const projects = {
      p: { name: 'p', files: { 'old.typ': 'content' }, currentFile: 'old.typ', modified: 'today', settings: {} },
    };
    setProjects(projects);

    const p = getProjects().p;
    p.files['new.typ'] = p.files['old.typ'];
    delete p.files['old.typ'];
    p.currentFile = 'new.typ';
    setProjects({ p });

    expect(getProjects().p.files['new.typ']).toBe('content');
    expect(getProjects().p.files['old.typ']).toBeUndefined();
  });
});

describe('search filtering', () => {
  test('filters projects by name', () => {
    const projects = {
      'alpha': { name: 'alpha', modified: 'today' },
      'beta': { name: 'beta', modified: 'today' },
      'gamma': { name: 'gamma', modified: 'today' },
    };
    const query = 'al';
    const filtered = Object.values(projects).filter(p =>
      p.name.toLowerCase().includes(query.toLowerCase())
    );
    expect(filtered).toHaveLength(1);
    expect(filtered[0].name).toBe('alpha');
  });

  test('shows all when query is empty', () => {
    const projects = { a: { name: 'a' }, b: { name: 'b' } };
    const filtered = Object.values(projects).filter(p => true);
    expect(filtered).toHaveLength(2);
  });
});

describe('sorting', () => {
  const projects = [
    { name: 'b', modified: '2024-01-02' },
    { name: 'a', modified: '2024-01-03' },
    { name: 'c', modified: '2024-01-01' },
  ];

  test('sorts by name ascending', () => {
    const sorted = [...projects].sort((a, b) => a.name.localeCompare(b.name));
    expect(sorted[0].name).toBe('a');
    expect(sorted[2].name).toBe('c');
  });

  test('sorts by modified descending', () => {
    const sorted = [...projects].sort((a, b) => (b.modified || '').localeCompare(a.modified || ''));
    expect(sorted[0].modified).toBe('2024-01-03');
    expect(sorted[2].modified).toBe('2024-01-01');
  });
});

describe('Dashboard view modes', () => {
  test('renders list rows when list view is selected', async () => {
    const onOpenProject = vi.fn();
    const onCreateProject = vi.fn();
    const onDeleteProject = vi.fn();
    const onStartFromGitLab = vi.fn();

    const { container } = render(
      <DashboardView
        projects={{
          alpha: { name: 'alpha', modified: 'today', location: 'personal' },
        }}
        onOpenProject={onOpenProject}
        onCreateProject={onCreateProject}
        onDeleteProject={onDeleteProject}
        onStartFromGitLab={onStartFromGitLab}
        sessionEmail={null}
        onLogout={vi.fn()}
      />
    );

    await userEvent.click(screen.getByRole('button', { name: /list view/i }));
    expect(container.querySelector('.dashboard-list-row')).toBeTruthy();
    expect(screen.getByText('alpha')).toBeTruthy();
  });
});

describe('Auth component', () => {
  test('renders sign in form', async () => {
    const Auth = (await import('./components/Auth')).default;
    render(<Auth />);
    expect(screen.getByRole('heading', { name: /sign in/i })).toBeTruthy();
    expect(screen.getByPlaceholderText('Email')).toBeTruthy();
    expect(screen.getByPlaceholderText('Password')).toBeTruthy();
  });

  test('shows forgot password link', async () => {
    const Auth = (await import('./components/Auth')).default;
    render(<Auth />);
    expect(screen.getByText('Forgot password?')).toBeTruthy();
  });

  test('switches to sign up mode', async () => {
    const Auth = (await import('./components/Auth')).default;
    render(<Auth />);
    await userEvent.click(screen.getByText('Sign up'));
    expect(await screen.findByText('Create account')).toBeTruthy();
  });
});

describe('App integration', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  test('creates project from dashboard and stays on dashboard', async () => {
    render(<App />);
    expect(await screen.findByRole('heading', { name: /dashboard/i })).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: /create project/i }));

    expect(await screen.findByRole('heading', { name: /create project/i })).toBeTruthy();
    const nameInput = screen.getByPlaceholderText('project-name');
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, 'sample-project');
    await userEvent.click(screen.getByRole('button', { name: /^create$/i }));

    expect(await screen.findByRole('heading', { name: /dashboard/i })).toBeTruthy();
    expect(await screen.findByText('sample-project')).toBeTruthy();
  });

  test('dashboard new folder action creates folder on dashboard', async () => {
    render(<App />);
    expect(await screen.findByRole('heading', { name: /dashboard/i })).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: /new folder/i }));

    expect(await screen.findByRole('heading', { name: /create folder/i })).toBeTruthy();
    const folderInput = screen.getByPlaceholderText('folder-name');
    await userEvent.clear(folderInput);
    await userEvent.type(folderInput, 'my-projects');
    await userEvent.click(screen.getByRole('button', { name: /^create folder$/i }));

    expect(await screen.findByRole('heading', { name: /dashboard/i })).toBeTruthy();
    expect(await screen.findByText('my-projects')).toBeTruthy();
  });

  test('creates folder and nested file from files panel', async () => {
    render(<App />);

    await userEvent.click(await screen.findByRole('button', { name: /create project/i }));
    const nameInput = await screen.findByPlaceholderText('project-name');
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, 'files-project');
    await userEvent.click(screen.getByRole('button', { name: /^create$/i }));

    await userEvent.click(await screen.findByText('files-project'));
    await userEvent.click(await screen.findByLabelText('Open files panel'));

    await userEvent.click(screen.getByLabelText('Create folder'));
    expect(await screen.findByRole('heading', { name: /create folder/i })).toBeTruthy();
    const folderInput = screen.getByPlaceholderText('chapters');
    await userEvent.clear(folderInput);
    await userEvent.type(folderInput, 'chapters');
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /^create folder$/i }));

    expect(await screen.findByText('chapters')).toBeTruthy();

    await userEvent.click(screen.getByLabelText('Create file'));
    expect(await screen.findByRole('heading', { name: /create file/i })).toBeTruthy();
    const fileInput = screen.getByPlaceholderText('file.typ');
    await userEvent.clear(fileInput);
    await userEvent.type(fileInput, 'chapters/intro');
    await userEvent.click(screen.getByRole('button', { name: /^create$/i }));

    expect(await screen.findByText('intro.typ')).toBeTruthy();
  });

  test('adds file directly into an existing folder action', async () => {
    render(<App />);

    await userEvent.click(await screen.findByRole('button', { name: /create project/i }));
    const nameInput = await screen.findByPlaceholderText('project-name');
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, 'appendix-project');
    await userEvent.click(screen.getByRole('button', { name: /^create$/i }));

    await userEvent.click(await screen.findByText('appendix-project'));
    await userEvent.click(await screen.findByLabelText('Open files panel'));
    await userEvent.click(await screen.findByLabelText('Create folder'));

    let folderInput = await screen.findByPlaceholderText('chapters');
    await userEvent.clear(folderInput);
    await userEvent.type(folderInput, 'appendix');
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /^create folder$/i }));

    await userEvent.click(await screen.findByLabelText('Create file in appendix'));
    const fileInput = await screen.findByPlaceholderText('file.typ');
    await userEvent.clear(fileInput);
    await userEvent.type(fileInput, 'notes');
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /^create$/i }));

    expect(await screen.findByText('notes.typ')).toBeTruthy();
  });
});
