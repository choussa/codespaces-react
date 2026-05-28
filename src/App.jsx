import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { $typst } from '@myriaddreamin/typst.ts';
import { EditorView, basicSetup } from 'codemirror';
import { Compartment } from '@codemirror/state';
import { markdown } from '@codemirror/lang-markdown';
import { oneDark } from '@codemirror/theme-one-dark';
import { lineNumbers, keymap } from '@codemirror/view';
import { autocompletion, closeBrackets } from '@codemirror/autocomplete';
import { indentOnInput } from '@codemirror/language';
import { vim } from '@replit/codemirror-vim';
import JSZip from 'jszip';
import {
  Folder, Search, Map as MapIcon, PenTool, Settings, Globe, HelpCircle,
  ChevronRight, Cloud, MoreHorizontal, Minus, Plus, Square,
  Check, Type, Bold, Italic, Underline, Heading, List, ListOrdered,
  Sigma, Code, AtSign, MessageSquare, ChevronDown, FilePlus,
  FolderPlus, FileText, Trash2, ArrowLeft, Pencil, LogOut, User, X
} from 'lucide-react';
import DashboardView from './components/DashboardView';
import DownloadDropdown from './components/DownloadDropdown';
import Auth from './components/Auth';
import {
  getLocalProjects, getLocalFolders, setLocalFolders,
  getLocalActiveProject, setLocalActiveProject, removeLocalActiveProject,
  syncProjectsToSupabase, syncFileToSupabase, syncFileAddToSupabase,
  syncFileDeleteToSupabase, syncFileRenameToSupabase, syncProjectDeleteToSupabase,
  loadProjectsFromSupabase,
} from './lib/storage';
import { supabase, isSupabaseReady } from './lib/supabase';

const DEFAULT_CODE = `= Hello, Typst!

This is *live* Typst rendering in the browser.

== Features

- Edit the code on the left
- See the result on the right

== Math

The sum $sum_(k=0)^n k$ is equal to $(n(n+1))/2$.

== Lists

- Bullet list item
  - Nested item
- Another item

+ Numbered list item
+ Another numbered item

#if 1 < 2 [
  *Conditional content* works too.
]`;

const DASHBOARD_COLORS = ['#1e3a5f', '#3b1f4e', '#1f4a3a', '#4a2c1a', '#2a2a3a', '#3a1a2a'];

const ZOOM_STEP = 0.25;
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 4;
const PAPER_W = 580;
const PAPER_H = 780;
const PREVIEW_SIZES = [
  { id: 'compact', label: 'Compact', hint: 'More editor space', value: 42 },
  { id: 'balanced', label: 'Balanced', hint: 'Even split', value: 50 },
  { id: 'wide', label: 'Wide', hint: 'More preview space', value: 62 },
];
const STORAGE_KEY_PROJECTS = 'typst-projects';
const STORAGE_KEY_ACTIVE = 'typst-active-project';
const MAX_STORAGE_BYTES = 104857600; // 100 MB

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const val = bytes / Math.pow(k, i);
  return (val < 10 ? val.toFixed(1) : Math.round(val)) + ' ' + sizes[i];
}

function toTimestamp(value) {
  const t = Date.parse(value || '');
  return Number.isNaN(t) ? 0 : t;
}

function normalizeProjectPath(raw) {
  const source = typeof raw === 'string' ? raw : '';
  return source
    .trim()
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
    .replace(/^\/+|\/+$/g, '')
    .split('/')
    .map(part => part.trim())
    .filter(Boolean)
    .join('/');
}

function normalizeFilePath(raw) {
  const normalized = normalizeProjectPath(raw);
  if (!normalized) return '';
  if (/\.[^/]+$/.test(normalized)) return normalized;
  return `${normalized}.typ`;
}

function normalizeFolderPath(raw) {
  return normalizeProjectPath(raw);
}

function getPaletteColor(name, palette) {
  const colors = palette?.length ? palette : ['#1e3a5f'];
  const base = typeof name === 'string' ? name : '';
  const idx = base.split('').reduce((a, c) => a + c.charCodeAt(0), 0) % colors.length;
  return colors[idx] || colors[0];
}

function getPathLabel(path) {
  const parts = (path || '').split('/').filter(Boolean);
  return parts[parts.length - 1] || path;
}

function getParentPath(path) {
  const parts = (path || '').split('/').filter(Boolean);
  if (parts.length <= 1) return '';
  return parts.slice(0, -1).join('/');
}

function mergeFolderList(folderList, projectMap, palette) {
  const map = new Map();
  (folderList || []).forEach(folder => {
    if (folder?.path) map.set(folder.path, folder);
  });

  let changed = false;
  const nowIso = new Date().toISOString();
  const addPath = (path) => {
    if (!path || map.has(path)) return;
    map.set(path, {
      path,
      name: getPathLabel(path),
      color: getPaletteColor(path, palette),
      createdAt: nowIso,
      updatedAt: nowIso,
    });
    changed = true;
  };

  Object.values(projectMap || {}).forEach(project => {
    const rawPath = project?.settings?.folderPath || '';
    const folderPath = normalizeFolderPath(rawPath);
    if (!folderPath) return;
    const parts = folderPath.split('/').filter(Boolean);
    for (let i = 0; i < parts.length; i++) {
      addPath(parts.slice(0, i + 1).join('/'));
    }
  });

  return { folders: Array.from(map.values()), changed };
}

function buildFileTree(fileMap) {
  const root = { path: '', folders: new Map(), files: [] };

  for (const filePath of Object.keys(fileMap || {}).sort((a, b) => a.localeCompare(b))) {
    const parts = filePath.split('/').filter(Boolean);
    if (!parts.length) continue;
    let node = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const folderName = parts[i];
      const folderPath = parts.slice(0, i + 1).join('/');
      if (!node.folders.has(folderName)) {
        node.folders.set(folderName, { name: folderName, path: folderPath, folders: new Map(), files: [] });
      }
      node = node.folders.get(folderName);
    }
    node.files.push({ name: parts[parts.length - 1], path: filePath });
  }

  const toArrayNode = (node) => ({
    path: node.path,
    files: node.files.sort((a, b) => a.name.localeCompare(b.name)),
    folders: Array.from(node.folders.values())
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(toArrayNode),
  });

  return toArrayNode(root);
}

function getUniqueFilePath(fileMap, desiredPath) {
  if (!fileMap[desiredPath]) return desiredPath;
  const slash = desiredPath.lastIndexOf('/');
  const dir = slash >= 0 ? desiredPath.slice(0, slash) : '';
  const file = slash >= 0 ? desiredPath.slice(slash + 1) : desiredPath;
  const extIndex = file.lastIndexOf('.');
  const base = extIndex > 0 ? file.slice(0, extIndex) : file;
  const ext = extIndex > 0 ? file.slice(extIndex) : '';

  let i = 2;
  while (true) {
    const nextFile = `${base}-${i}${ext}`;
    const candidate = dir ? `${dir}/${nextFile}` : nextFile;
    if (!fileMap[candidate]) return candidate;
    i += 1;
  }
}

function mergeProjectsByFreshness(localProjects, remoteProjects, activeProjectName, hasDirtyActiveProject) {
  const merged = { ...localProjects };

  for (const [name, remoteProject] of Object.entries(remoteProjects || {})) {
    const localProject = localProjects[name];
    if (!localProject) {
      merged[name] = remoteProject;
      continue;
    }

    if (hasDirtyActiveProject && name === activeProjectName) {
      continue;
    }

    if (toTimestamp(remoteProject.updatedAt) >= toTimestamp(localProject.updatedAt)) {
      merged[name] = remoteProject;
    }
  }

  return merged;
}

function useDebounce(value, delay) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

const MenuIconRight = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="21" y1="6" x2="3" y2="6" />
    <line x1="21" y1="12" x2="9" y2="12" />
    <line x1="21" y1="18" x2="7" y2="18" />
    <polyline points="3 10 7 14 3 18" />
  </svg>
);

const MenuIconLeft = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="3" y1="6" x2="21" y2="6" />
    <line x1="3" y1="12" x2="15" y2="12" />
    <line x1="3" y1="18" x2="17" y2="18" />
    <polyline points="21 10 17 14 21 18" />
  </svg>
);

function OutlineView({ headings, onNavigate }) {
  if (!headings.length) {
    return <p className="sidebar-muted">No headings found in document.</p>;
  }
  return (
    <div className="outline-list">
      {headings.map((h, i) => (
        <div
          key={i}
          className="outline-item"
          style={{ paddingLeft: (h.level - 1) * 16 + 'px' }}
          onClick={() => onNavigate?.(h.line)}
        >
          <span className="outline-marker">{'='.repeat(h.level)}</span>
          <span className="outline-text">{h.text}</span>
        </div>
      ))}
    </div>
  );
}

function AppDialog({ dialog, onCancel, onConfirm }) {
  const [value, setValue] = useState(dialog.defaultValue || '');

  useEffect(() => {
    setValue(dialog.defaultValue || '');
  }, [dialog.defaultValue, dialog.open]);

  useEffect(() => {
    if (!dialog.open) return;
    const onKeyDown = (e) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [dialog.open, onCancel]);

  if (!dialog.open) return null;

  const isPrompt = dialog.kind === 'prompt';
  const minLength = dialog.minLength || 0;
  const canConfirm = !isPrompt || (dialog.required ? value.trim().length >= minLength : value.length === 0 || value.trim().length >= minLength);

  return (
    <div className="app-dialog-backdrop" role="presentation" onClick={onCancel}>
      <div className="app-dialog" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()}>
        <div className="app-dialog-header">
          <h3>{dialog.title}</h3>
          <button className="app-dialog-close" onClick={onCancel} aria-label="Close dialog">
            <X size={14} />
          </button>
        </div>
        {dialog.message && <p className="app-dialog-message">{dialog.message}</p>}

        {isPrompt && (
          <form
            onSubmit={e => {
              e.preventDefault();
              if (canConfirm) onConfirm(value.trim());
            }}
          >
            <input
              className="app-dialog-input"
              type={dialog.secret ? 'password' : 'text'}
              placeholder={dialog.placeholder || ''}
              value={value}
              onChange={e => setValue(e.target.value)}
              minLength={minLength || undefined}
              autoFocus
            />
            {minLength > 0 && <p className="app-dialog-hint">Minimum {minLength} characters</p>}
            <div className="app-dialog-actions">
              <button type="button" className="app-dialog-btn" onClick={onCancel}>{dialog.cancelLabel || 'Cancel'}</button>
              <button type="submit" className={`app-dialog-btn app-dialog-btn--primary${dialog.danger ? ' app-dialog-btn--danger' : ''}`} disabled={!canConfirm}>
                {dialog.confirmLabel || 'Confirm'}
              </button>
            </div>
          </form>
        )}

        {!isPrompt && (
          <div className="app-dialog-actions">
            <button type="button" className="app-dialog-btn" onClick={onCancel}>{dialog.cancelLabel || 'Cancel'}</button>
            <button type="button" className={`app-dialog-btn app-dialog-btn--primary${dialog.danger ? ' app-dialog-btn--danger' : ''}`} onClick={() => onConfirm(true)}>
              {dialog.confirmLabel || 'Confirm'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function ToastStack({ toasts, onDismiss }) {
  return (
    <div className="toast-stack" aria-live="polite" aria-atomic="true">
      {toasts.map(toast => (
        <div key={toast.id} className={`toast-item toast-item--${toast.tone}`}>
          <span>{toast.message}</span>
          <button className="toast-close" onClick={() => onDismiss(toast.id)} aria-label="Dismiss notification">
            <X size={12} />
          </button>
        </div>
      ))}
    </div>
  );
}

function EditorViewInner({
  files, currentFile, setCurrentFile, code, onCodeChange,
  status, setStatus, svg, setSvg, error, setError,
  zoom, setZoom,
  editorFontSize, setEditorFontSize,
  editorFontFamily, setEditorFontFamily,
  showLineNumbers, setShowLineNumbers,
  writingDirection, setWritingDirection,
  ctrlSDisabled, setCtrlSDisabled,
  vimMode, setVimMode,
  projectName, projectLocation, savedIndicator,
  onBack, onPersist, addFile, addFolder, deleteFile, renameFile, dirtyFiles, onDeleteProject, exportFormat,
  getCursorInfo, getWordCount, extractOutline, gotoLine, activeSidebar, setActiveSidebar,
  debouncedCode,
  totalStorageBytes,
  maxStorageBytes,
  formatBytes,
  sessionEmail,
  onLogout,
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [viewMenuOpen, setViewMenuOpen] = useState(false);
  const [previewWidth, setPreviewWidth] = useState(PREVIEW_SIZES[1].value);
  const [previewActive, setPreviewActive] = useState(false);
  const [expandedFolders, setExpandedFolders] = useState({});
  const editorRef = useRef(null);
  const viewRef = useRef(null);
  const prevCodeRef = useRef('');
  const themeCompartment = useRef(new Compartment());
  const lineNumbersCompartment = useRef(new Compartment());
  const dirCompartment = useRef(new Compartment());
  const vimCompartment = useRef(new Compartment());
  const previewBodyRef = useRef(null);
  const pinchRef = useRef(null);
  const dragRef = useRef(null);
  const viewMenuRef = useRef(null);

  const persist = useCallback(() => {
    onPersist();
  }, [onPersist]);

  const onCodeChangeRef = useRef(onCodeChange);
  useEffect(() => { onCodeChangeRef.current = onCodeChange; }, [onCodeChange]);

  const persistRef = useRef(persist);
  useEffect(() => { persistRef.current = persist; }, [persist]);

  const ctrlSDisabledRef = useRef(ctrlSDisabled);
  useEffect(() => { ctrlSDisabledRef.current = ctrlSDisabled; }, [ctrlSDisabled]);

  const handleGotoLine = useCallback((line) => {
    const view = viewRef.current;
    if (!view) return;
    try {
      const pos = view.state.doc.line(line);
      view.dispatch({
        selection: { anchor: pos.from },
        scrollIntoView: true,
      });
      view.focus();
    } catch {}
  }, []);

  useEffect(() => {
    const parts = currentFile.split('/').filter(Boolean);
    if (parts.length <= 1) return;
    const next = {};
    for (let i = 0; i < parts.length - 1; i++) {
      next[parts.slice(0, i + 1).join('/')] = true;
    }
    setExpandedFolders(prev => ({ ...prev, ...next }));
  }, [currentFile]);

  useEffect(() => {
    const base = import.meta.env.BASE_URL || '/';
    $typst.setCompilerInitOptions({
      getModule: () => `${base}wasm/typst_ts_web_compiler_bg.wasm`,
    });
    $typst.setRendererInitOptions({
      getModule: () => `${base}wasm/typst_ts_renderer_bg.wasm`,
    });
    setStatus('ready');
  }, [setStatus]);

  useEffect(() => {
    if (!editorRef.current || viewRef.current) return;

    const updateListener = EditorView.updateListener.of(v => {
      if (v.docChanged) {
        onCodeChangeRef.current?.(v.state.doc.toString());
      }
    });

    const saveKeymap = keymap.of([
      {
        key: 'Mod-s',
        run: () => {
          if (ctrlSDisabledRef.current) return false;
          persistRef.current?.();
          return true;
        },
      },
    ]);

    viewRef.current = new EditorView({
      doc: code,
      extensions: [
        basicSetup,
        markdown(),
        oneDark,
        updateListener,
        saveKeymap,
        autocompletion(),
        closeBrackets(),
        indentOnInput(),
        themeCompartment.current.of(EditorView.theme({
          '&': { fontSize: editorFontSize + 'px' },
          '.cm-scroller': { fontFamily: editorFontFamily },
        })),
        lineNumbersCompartment.current.of(showLineNumbers ? lineNumbers() : []),
        dirCompartment.current.of(EditorView.theme({
          '&': { direction: writingDirection },
        })),
        vimCompartment.current.of(vimMode ? vim() : []),
      ],
      parent: editorRef.current,
    });

    return () => {
      viewRef.current?.destroy();
      viewRef.current = null;
    };
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const newCode = files[currentFile] || '';
    if (view.state.doc.toString() !== newCode) {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: newCode },
      });
    }
  }, [currentFile]);

  useEffect(() => {
    if (!searchQuery.trim()) { setSearchResults([]); return; }
    const lines = code.split('\n');
    const results = [];
    const lower = searchQuery.toLowerCase();
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.toLowerCase().includes(lower)) {
        results.push({ line: i + 1, text: line });
      }
    }
    setSearchResults(results);
  }, [searchQuery, code]);

  useEffect(() => {
    if (!viewMenuOpen) return;
    const onDocClick = (e) => {
      if (!viewMenuRef.current || viewMenuRef.current.contains(e.target)) return;
      setViewMenuOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [viewMenuOpen]);

  useEffect(() => {
    const onWheel = (e) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const previewEl = previewBodyRef.current;
      const isPreview = previewEl && previewEl.contains(e.target);
      if (!isPreview) return;
      const dir = e.deltaY > 0 ? -1 : 1;
      setZoom((prev) => {
        const next = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, prev + dir * 0.1));
        return Math.round(next * 100) / 100;
      });
    };

    const onKeyDown = (e) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (!['+', '-', '=', '0'].includes(e.key)) return;
      e.preventDefault();
      if (!previewActive) return;
      if (e.key === '0') {
        setZoom(1);
        return;
      }
      if (e.key === '+' || e.key === '=') {
        setZoom((z) => Math.min(ZOOM_MAX, z + ZOOM_STEP));
        return;
      }
      if (e.key === '-') {
        setZoom((z) => Math.max(ZOOM_MIN, z - ZOOM_STEP));
      }
    };

    const onGesture = (e) => { e.preventDefault(); };

    window.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('gesturestart', onGesture);
    window.addEventListener('gesturechange', onGesture);
    window.addEventListener('gestureend', onGesture);

    return () => {
      window.removeEventListener('wheel', onWheel);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('gesturestart', onGesture);
      window.removeEventListener('gesturechange', onGesture);
      window.removeEventListener('gestureend', onGesture);
    };
  }, [previewActive, setZoom]);

  useEffect(() => {
    if (!viewRef.current) return;
    viewRef.current.dispatch({
      effects: themeCompartment.current.reconfigure(EditorView.theme({
        '&': { fontSize: editorFontSize + 'px' },
        '.cm-scroller': { fontFamily: editorFontFamily },
      }))
    });
  }, [editorFontSize, editorFontFamily]);

  useEffect(() => {
    if (!viewRef.current) return;
    viewRef.current.dispatch({
      effects: lineNumbersCompartment.current.reconfigure(showLineNumbers ? lineNumbers() : [])
    });
  }, [showLineNumbers]);

  useEffect(() => {
    if (!viewRef.current) return;
    viewRef.current.dispatch({
      effects: dirCompartment.current.reconfigure(EditorView.theme({
        '&': { direction: writingDirection },
      }))
    });
  }, [writingDirection]);

  useEffect(() => {
    if (!viewRef.current) return;
    viewRef.current.dispatch({
      effects: vimCompartment.current.reconfigure(vimMode ? vim() : [])
    });
  }, [vimMode]);

  useEffect(() => {
    if (!debouncedCode.trim()) {
      setSvg('');
      setError('');
      return;
    }
    if (prevCodeRef.current === debouncedCode) return;
    prevCodeRef.current = debouncedCode;

    let cancelled = false;
    setStatus('compiling');
    setError('');

    $typst.svg({ mainContent: debouncedCode })
      .then(result => {
        if (!cancelled) {
          setSvg(result);
          setStatus('ready');
        }
      })
      .catch(e => {
        if (!cancelled) {
          setError(e.message || String(e));
          setSvg('');
          setStatus('error');
        }
      });

    return () => { cancelled = true; };
  }, [debouncedCode, setStatus, setSvg, setError]);

  useEffect(() => {
    const el = previewBodyRef.current;
    if (!el) return;

    const onTouchStart = (e) => {
      if (e.touches.length === 2) {
        e.preventDefault();
        const t = e.touches;
        pinchRef.current = {
          startDist: Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY),
          startZoom: zoom,
        };
      }
    };

    const onTouchMove = (e) => {
      if (e.touches.length === 2 && pinchRef.current) {
        e.preventDefault();
        const t = e.touches;
        const dist = Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
        const ratio = dist / pinchRef.current.startDist;
        const newZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, pinchRef.current.startZoom * ratio));
        setZoom(Math.round(newZoom * 100) / 100);
      }
    };

    const onTouchEnd = () => { pinchRef.current = null; };

    const onMouseDown = (e) => {
      if (e.button !== 0) return;
      dragRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        scrollLeft: el.scrollLeft,
        scrollTop: el.scrollTop,
      };
      el.classList.add('preview-body--grabbing');
      el.style.userSelect = 'none';
    };

    const onMouseMove = (e) => {
      if (!dragRef.current) return;
      e.preventDefault();
      const dx = e.clientX - dragRef.current.startX;
      const dy = e.clientY - dragRef.current.startY;
      el.scrollLeft = dragRef.current.scrollLeft - dx;
      el.scrollTop = dragRef.current.scrollTop - dy;
    };

    const onMouseUp = () => {
      if (!dragRef.current) return;
      dragRef.current = null;
      el.classList.remove('preview-body--grabbing');
      el.style.userSelect = '';
    };

    el.addEventListener('touchstart', onTouchStart, { passive: false });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd);
    el.addEventListener('mousedown', onMouseDown);
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);

    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
      el.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
  }, [zoom, setZoom]);

  const insertAtCursor = useCallback((text) => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      changes: { from: view.state.selection.main.from, insert: text }
    });
    view.focus();
  }, []);

  const toolbarActions = {
    heading: () => insertAtCursor('= '),
    bold: () => {
      const view = viewRef.current;
      if (!view) return;
      const { from, to } = view.state.selection.main;
      const selected = view.state.sliceDoc(from, to);
      insertAtCursor(selected ? `*${selected}*` : '*bold*');
    },
    italic: () => {
      const view = viewRef.current;
      if (!view) return;
      const { from, to } = view.state.selection.main;
      const selected = view.state.sliceDoc(from, to);
      insertAtCursor(selected ? `_${selected}_` : '_italic_');
    },
    underline: () => insertAtCursor('#underline[text]'),
    headingInsert: () => insertAtCursor('\n== '),
    bulletList: () => insertAtCursor('\n- '),
    numberedList: () => insertAtCursor('\n+ '),
    math: () => {
      const view = viewRef.current;
      if (!view) return;
      const { from, to } = view.state.selection.main;
      const selected = view.state.sliceDoc(from, to);
      insertAtCursor(selected ? `$${selected}$` : '$ ');
    },
    code: () => {
      const view = viewRef.current;
      if (!view) return;
      const { from, to } = view.state.selection.main;
      const selected = view.state.sliceDoc(from, to);
      insertAtCursor(selected ? '`' + selected + '`' : '`code`');
    },
    atSign: () => insertAtCursor('@import "'),
    comment: () => insertAtCursor('/* comment */'),
  };

  const exportSvg = async () => {
    if (!code.trim()) return;
    try {
      setStatus('compiling');
      setError('');
      const result = await $typst.svg({ mainContent: code });
      const blob = new Blob([result], { type: 'image/svg+xml' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${currentFile.replace('.typ', '')}.svg`;
      a.click();
      URL.revokeObjectURL(url);
      setStatus('ready');
    } catch (e) {
      setStatus('error');
      setError('SVG export failed: ' + (e.message || String(e)));
    }
  };

  const exportPdf = async () => {
    try {
      setStatus('compiling');
      setError('');
      const result = await $typst.pdf({ mainContent: code });
      const blob = new Blob([result], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${currentFile.replace('.typ', '')}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
      setStatus('ready');
    } catch (e) {
      setStatus('error');
      setError('PDF export failed: ' + (e.message || String(e)));
    }
  };

  const exportPng = async () => {
    if (!code.trim()) return;
    try {
      setStatus('compiling');
      setError('');
      const svgResult = await $typst.svg({ mainContent: code });
      setStatus('ready');
      const container = document.createElement('div');
      container.innerHTML = svgResult;
      const svgEl = container.querySelector('svg');
      if (!svgEl) return;
      const svgData = new XMLSerializer().serializeToString(svgEl);
      const canvas = document.createElement('canvas');
      const rect = svgEl.getBoundingClientRect();
      const scale = 2;
      canvas.width = (rect.width || 600) * scale;
      canvas.height = (rect.height || 800) * scale;
      const ctx = canvas.getContext('2d');
      const img = new Image();
      const blob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      img.onload = () => {
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((pngBlob) => {
          const pngUrl = URL.createObjectURL(pngBlob);
          const a = document.createElement('a');
          a.href = pngUrl;
          a.download = `${currentFile.replace('.typ', '')}.png`;
          a.click();
          URL.revokeObjectURL(pngUrl);
          URL.revokeObjectURL(url);
        });
      };
      img.src = url;
    } catch (e) {
      setStatus('error');
      setError('PNG export failed: ' + (e.message || String(e)));
    }
  };

  const exportZip = async () => {
    const zip = new JSZip();
    Object.entries(files).forEach(([name, content]) => zip.file(name, content));
    const blob = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${projectName}.zip`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExport = (format) => {
    if (format === 'pdf') exportPdf();
    else if (format === 'svg') exportSvg();
    else if (format === 'png') exportPng();
    else if (format === 'zip') exportZip();
  };

  const cursorInfo = getCursorInfo ? getCursorInfo(viewRef) : { line: 1, col: 1 };
  const wordCount = getWordCount ? getWordCount(code) : 0;
  const headings = extractOutline ? extractOutline(debouncedCode) : [];

  const toolbarButtons = [
    { icon: Type, action: 'heading' },
    { icon: Bold, action: 'bold' },
    { icon: Italic, action: 'italic' },
    { icon: Underline, action: 'underline' },
    { icon: Heading, action: 'headingInsert' },
    { icon: List, action: 'bulletList' },
    { icon: ListOrdered, action: 'numberedList' },
    { icon: Sigma, action: 'math' },
    { icon: Code, action: 'code' },
    { icon: AtSign, action: 'atSign' },
    { icon: MessageSquare, action: 'comment' },
  ];

  const fileTree = useMemo(() => buildFileTree(files), [files]);

  const renderFolder = (folder, depth = 0) => {
    const isOpen = expandedFolders[folder.path] !== false;
    return (
      <div key={folder.path || 'root'} className="sidebar-tree-node">
        {!!folder.path && (
          <div className="sidebar-tree-folder-row" style={{ paddingLeft: `${depth * 14 + 6}px` }}>
            <button
              className="sidebar-tree-folder"
              onClick={() => setExpandedFolders(prev => ({ ...prev, [folder.path]: !isOpen }))}
              type="button"
              aria-label={`Toggle folder ${getPathLabel(folder.path)}`}
              aria-expanded={isOpen}
            >
              <ChevronDown size={12} className={`sidebar-tree-chevron${isOpen ? '' : ' sidebar-tree-chevron--closed'}`} />
              <Folder size={13} />
              <span>{getPathLabel(folder.path)}</span>
            </button>
            <div className="sidebar-folder-actions">
              <button
                className="sidebar-file-btn"
                onClick={() => addFile(folder.path)}
                title="New file in folder"
                type="button"
                aria-label={`Create file in ${getPathLabel(folder.path)}`}
              >
                <FilePlus size={12} />
              </button>
            </div>
          </div>
        )}

        {(isOpen || !folder.path) && (
          <>
            {folder.folders.map(child => renderFolder(child, depth + (folder.path ? 1 : 0)))}
            {folder.files.map(file => (
              <div
                key={file.path}
                className={`sidebar-tree-file-row${currentFile === file.path ? ' active' : ''}`}
                style={{ paddingLeft: `${(depth + 1) * 14 + 16}px` }}
              >
                <button
                  className="sidebar-tree-file"
                  onClick={() => setCurrentFile(file.path)}
                  title={file.path}
                >
                  {dirtyFiles[file.path] && <span className="file-dirty-dot" />}
                  <FileText size={12} />
                  <span>{file.name}</span>
                </button>
                <div className="sidebar-file-actions">
                  {Object.keys(files).length > 1 && (
                    <button className="sidebar-file-btn" onClick={() => renameFile(file.path)} title="Rename file" type="button" aria-label={`Rename ${file.path}`}>
                      <Pencil size={12} />
                    </button>
                  )}
                  {Object.keys(files).length > 1 && (
                    <button className="sidebar-file-btn sidebar-file-del" onClick={() => deleteFile(file.path)} title="Delete file" type="button" aria-label={`Delete ${file.path}`}>
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </>
        )}
      </div>
    );
  };

  const renderSidebarContent = () => {
    if (activeSidebar === 'settings') {
      return (
        <div className="sidebar-panel">
          <div className="sidebar-header sidebar-header--sticky">
            <h2>Settings</h2>
          </div>
          <div className="sidebar-body">
            <div className="sidebar-section">
              <h3>Project settings</h3>
              <div className="sidebar-field">
                <label>Name</label>
                <input type="text" value={projectName} readOnly />
              </div>
              <div className="sidebar-field">
                <label>Location</label>
                <div className="select-wrap">
                  <select value={projectLocation} onChange={() => {}} aria-label="Project location" >
                    <option>black</option>
                    <option>white</option>
                  </select>
                  <ChevronDown className="select-chevron" size={16} />
                </div>
              </div>
              <div className="sidebar-field">
                <label>Compiler</label>
                <div className="select-wrap">
                  <select onChange={() => {}} aria-label="Compiler version">
                    <option>Typst 0.14.1</option>
                  </select>
                  <ChevronDown className="select-chevron" size={16} />
                </div>
              </div>
            </div>

            <div className="sidebar-section">
              <h3>Editor settings</h3>
              <div className="sidebar-field">
                <label>Font size</label>
                <div className="number-input-wrap">
                  <input type="text" value={editorFontSize} onChange={e => setEditorFontSize(Number(e.target.value) || 15)} />
                  <div className="number-arrows">
                    <button onClick={() => setEditorFontSize(s => Math.min(40, s + 1))}><ChevronDown size={12} /></button>
                    <button onClick={() => setEditorFontSize(s => Math.max(8, s - 1))}><ChevronDown size={12} /></button>
                  </div>
                </div>
              </div>
              <div className="sidebar-field">
                <label>Line numbers</label>
                <div className="select-wrap">
                  <select value={showLineNumbers ? 'Normal' : 'Off'} onChange={e => setShowLineNumbers(e.target.value === 'Normal')}>
                    <option>Normal</option>
                    <option>Off</option>
                  </select>
                  <ChevronDown className="select-chevron" size={16} />
                </div>
              </div>
              <div className="sidebar-field">
                <label>Writing direction</label>
                <div className="dir-toggle">
                  <button className={writingDirection === 'ltr' ? 'active' : ''} onClick={() => setWritingDirection('ltr')}>
                    <MenuIconRight />
                  </button>
                  <button className={writingDirection === 'rtl' ? 'active' : ''} onClick={() => setWritingDirection('rtl')}>
                    <MenuIconLeft />
                  </button>
                </div>
              </div>
              <div className="sidebar-field sidebar-field--col">
                <label>Font family</label>
                <input type="text" value={editorFontFamily} onChange={e => setEditorFontFamily(e.target.value)} className="font-mono" />
              </div>
              <label className="sidebar-toggle" onClick={() => setCtrlSDisabled(prev => !prev)}>
                <span>Disable browser Ctrl-S shortcut</span>
                <div className={`checkbox ${ctrlSDisabled ? '' : 'checked'}`}>
                  {!ctrlSDisabled && <Check size={12} />}
                </div>
              </label>
              <label className="sidebar-toggle" onClick={() => setVimMode(prev => !prev)}>
                <span>Vim mode</span>
                <div className={`checkbox ${vimMode ? 'checked' : ''}`}>
                  {vimMode && <Check size={12} />}
                </div>
              </label>
            </div>
            <div className="sidebar-section">
              <h3>Storage</h3>
              <div className="sidebar-field">
                <label>Usage</label>
                <span className="storage-usage-text">
                  {formatBytes(totalStorageBytes)} / {formatBytes(maxStorageBytes)}
                </span>
              </div>
              <div className="storage-bar-track">
                <div
                  className={`storage-bar-fill${totalStorageBytes > maxStorageBytes * 0.8 ? ' storage-bar-fill--warn' : ''}`}
                  style={{ width: Math.min(100, (totalStorageBytes / maxStorageBytes) * 100) + '%' }}
                />
              </div>
              {totalStorageBytes > maxStorageBytes * 0.8 && (
                <p className="storage-warning">Running low on storage</p>
              )}
            </div>
            <div className="sidebar-section sidebar-delete">
            <button onClick={onDeleteProject} type="button">
                Delete project
              </button>
            </div>
          </div>
        </div>
      );
    }

    if (activeSidebar === 'files') {
      return (
        <div className="sidebar-panel">
          <div className="sidebar-header sidebar-header--between">
            <h2>Files</h2>
            <div className="sidebar-header-actions">
              <button className="sidebar-header-btn" onClick={addFolder} title="New folder" type="button" aria-label="Create folder">
                <FolderPlus size={16} />
              </button>
              <button className="sidebar-header-btn" onClick={() => addFile()} title="New file" type="button" aria-label="Create file">
                <FilePlus size={16} />
              </button>
            </div>
          </div>
          <div className="sidebar-body">
            <div className="sidebar-section">
              {fileTree.folders.map(folder => renderFolder(folder, 0))}
              {fileTree.files.map(file => (
                <div key={file.path} className={`sidebar-tree-file-row${currentFile === file.path ? ' active' : ''}`} style={{ paddingLeft: '16px' }}>
                  <button className="sidebar-tree-file" onClick={() => setCurrentFile(file.path)} title={file.path}>
                    {dirtyFiles[file.path] && <span className="file-dirty-dot" />}
                    <FileText size={12} />
                    <span>{file.name}</span>
                  </button>
                  <div className="sidebar-file-actions">
                    {Object.keys(files).length > 1 && (
                      <button className="sidebar-file-btn" onClick={() => renameFile(file.path)} title="Rename file" type="button" aria-label={`Rename ${file.path}`}>
                        <Pencil size={12} />
                      </button>
                    )}
                    {Object.keys(files).length > 1 && (
                      <button className="sidebar-file-btn sidebar-file-del" onClick={() => deleteFile(file.path)} title="Delete file" type="button" aria-label={`Delete ${file.path}`}>
                        <Trash2 size={12} />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      );
    }

    if (activeSidebar === 'search') {
      return (
        <div className="sidebar-panel">
          <div className="sidebar-header">
            <h2>Search</h2>
          </div>
          <div className="sidebar-body">
            <div className="sidebar-section">
              <input
                type="text"
                placeholder="Search in current file..."
                className="sidebar-search-input"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
              />
            </div>
            <div className="sidebar-section">
              {searchQuery.trim() && searchResults.length === 0 && (
                <p className="sidebar-muted">No matches found.</p>
              )}
              {searchResults.map((r, i) => (
                <div key={i} className="search-result" onClick={() => handleGotoLine(r.line)}>
                  <span className="search-result-line">L{r.line}</span>
                  <span className="search-result-text">{r.text}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      );
    }

    if (activeSidebar === 'outline') {
      return (
        <div className="sidebar-panel">
          <div className="sidebar-header">
            <h2>Outline</h2>
          </div>
          <div className="sidebar-body">
            <div className="sidebar-section">
              <OutlineView headings={headings} onNavigate={handleGotoLine} />
            </div>
          </div>
        </div>
      );
    }

    if (activeSidebar === 'pen') {
      return (
        <div className="sidebar-panel">
          <div className="sidebar-header">
            <h2>Pen Settings</h2>
          </div>
          <div className="sidebar-body">
            <div className="sidebar-section">
              <p className="sidebar-muted">Drawing and annotation tools.</p>
            </div>
          </div>
        </div>
      );
    }

    if (activeSidebar === 'globe') {
      return (
        <div className="sidebar-panel">
          <div className="sidebar-header">
            <h2>Language</h2>
          </div>
          <div className="sidebar-body">
            <div className="sidebar-section">
              <div className="sidebar-field">
                <label>Interface</label>
                <div className="select-wrap">
                  <select>
                    <option>English</option>
                  </select>
                  <ChevronDown className="select-chevron" size={16} />
                </div>
              </div>
            </div>
          </div>
        </div>
      );
    }

    return null;
  };

  return (
    <>
      {/* Top Navigation */}
      <div className="top-nav">
        <div className="top-nav-left">
          <button className="top-nav-back top-nav-back-btn" onClick={onBack} type="button" aria-label="Back to dashboard">
            <ChevronRight size={16} className="rotate-180" />
            <span>Typst</span>
          </button>
          <div className="top-nav-menu">
            <button type="button" className="top-nav-menu-btn">File</button>
            <button type="button" className="top-nav-menu-btn">Edit</button>
            <div className={`top-nav-menu-item${viewMenuOpen ? ' active' : ''}`} ref={viewMenuRef}>
              <button
                type="button"
                className="top-nav-menu-btn"
                onClick={() => setViewMenuOpen((open) => !open)}
              >
                View
              </button>
              {viewMenuOpen && (
                <div className="top-nav-dropdown">
                  <div className="top-nav-dropdown-title">Preview width</div>
                  {PREVIEW_SIZES.map((size) => (
                    <button
                      key={size.id}
                      type="button"
                      className={`top-nav-dropdown-item${previewWidth === size.value ? ' active' : ''}`}
                      onClick={() => {
                        setPreviewWidth(size.value);
                        setViewMenuOpen(false);
                      }}
                    >
                      <span>
                        {size.label}
                        <small>{size.hint}</small>
                      </span>
                      {previewWidth === size.value && <Check size={14} />}
                    </button>
                  ))}
                  <div className="top-nav-dropdown-divider" />
                  <button
                    type="button"
                    className="top-nav-dropdown-item"
                    onClick={() => {
                      setPreviewWidth(PREVIEW_SIZES[1].value);
                      setZoom(1);
                      setViewMenuOpen(false);
                    }}
                  >
                    <span>
                      Reset view
                      <small>Restore balanced layout</small>
                    </span>
                  </button>
                </div>
              )}
            </div>
            <button type="button" className="top-nav-menu-btn">Help</button>
          </div>
        </div>
        <div className="top-nav-center">
          <Cloud size={16} />
          <span>{projectLocation}</span>
          <ChevronRight size={12} />
          <span>{projectName}</span>
          <ChevronRight size={12} />
          <span className="top-nav-current">{currentFile}</span>
          {savedIndicator && <span className="saved-indicator">Saved</span>}
        </div>
        <div />
      </div>

      {/* File tabs */}
      {Object.keys(files).length > 1 && (
        <div className="file-tabs">
          {Object.keys(files).map(name => (
            <div
              key={name}
              className={`file-tab ${currentFile === name ? 'active' : ''}`}
              onClick={() => setCurrentFile(name)}
            >
              <span>{name}</span>
            </div>
          ))}
        </div>
      )}

      {/* Main workspace */}
      <div className="workspace" style={{ '--preview-width': `${previewWidth}%` }}>
        {/* Activity Bar */}
        <div className="activity-bar">
          <div className="activity-bar-top">
            {[
              { id: 'files', icon: Folder },
              { id: 'search', icon: Search },
               { id: 'outline', icon: MapIcon },
              { id: 'pen', icon: PenTool, badge: 5 },
              { id: 'settings', icon: Settings },
              { id: 'globe', icon: Globe },
            ].map(item => (
                <button
                  key={item.id}
                  className={`activity-btn ${activeSidebar === item.id ? 'active' : ''}`}
                  onClick={() => setActiveSidebar(activeSidebar === item.id ? null : item.id)}
                  type="button"
                  aria-label={`Open ${item.id} panel`}
                >
                <item.icon size={20} />
                {item.badge && <span className="activity-badge">{item.badge}</span>}
              </button>
            ))}
          </div>
          <div className="activity-bar-bottom">
            {sessionEmail && (
              <div className="activity-user-menu">
                <div className="activity-avatar" title={sessionEmail}>
                  {sessionEmail[0].toUpperCase()}
                </div>
                <button className="activity-btn activity-logout" onClick={onLogout} title="Sign out" type="button" aria-label="Sign out">
                  <LogOut size={16} />
                </button>
              </div>
            )}
            <button className="activity-btn" type="button" aria-label="Help"><HelpCircle size={20} /></button>
            <div className="activity-brand">typst</div>
          </div>
        </div>

        {/* Sidebar Panel */}
        {activeSidebar && <div className="sidebar">{renderSidebarContent()}</div>}

        {/* Editor Pane */}
        <div className="editor-pane">
          <div className="editor-toolbar">
            {toolbarButtons.map((btn, i) => (
              <button key={i} className="editor-toolbar-btn" onClick={toolbarActions[btn.action]} title={btn.action} type="button" aria-label={btn.action}>
                <btn.icon size={16} />
              </button>
            ))}
          </div>
          <div className="editor-body">
            <div className="editor-cm-wrap" ref={editorRef} />
          </div>
        </div>

        {/* Preview Pane */}
        <div className="preview-pane">
          <div className="preview-toolbar">
            <div className="preview-toolbar-left">
              <button className="preview-toolbar-btn" type="button" aria-label="Collapse preview panel"><ChevronRight size={16} className="rotate-180" /></button>
            </div>
            <div className="preview-zoom">
              <button onClick={() => setZoom(z => Math.max(ZOOM_MIN, z - ZOOM_STEP))} type="button" aria-label="Zoom out"><Minus size={14} /></button>
              <span>{Math.round(zoom * 100)}%</span>
              <button onClick={() => setZoom(z => Math.min(ZOOM_MAX, z + ZOOM_STEP))} type="button" aria-label="Zoom in"><Plus size={14} /></button>
              <div className="preview-zoom-divider" />
              <button onClick={() => setZoom(1)} type="button" aria-label="Reset zoom"><Square size={12} /></button>
            </div>
            <div className="preview-toolbar-right">
              <DownloadDropdown onExport={handleExport} disabled={!debouncedCode.trim()} />
              <button className="preview-toolbar-btn" type="button" aria-label="More preview actions"><MoreHorizontal size={16} /></button>
            </div>
          </div>
          <div
            className={`preview-body${zoom > 1 ? ' preview-body--zoomed' : ''}`}
            ref={previewBodyRef}
            tabIndex={0}
            onPointerEnter={() => setPreviewActive(true)}
            onPointerLeave={() => setPreviewActive(false)}
            onFocus={() => setPreviewActive(true)}
            onBlur={() => setPreviewActive(false)}
          >
            {error && <pre className="preview-error">{error}</pre>}
            <div
              className="preview-paper-wrap"
              style={{ width: `${PAPER_W * zoom}px`, minHeight: `${PAPER_H * zoom}px` }}
            >
              <div
                className="preview-paper"
                style={{ transform: `scale(${zoom})`, transformOrigin: 'top left' }}
              >
                {svg ? (
                  <div className="preview-content" dangerouslySetInnerHTML={{ __html: svg }} />
                ) : (
                  <div className="preview-placeholder">
                    {debouncedCode.trim() ? 'Compiling...' : 'Enter Typst code'}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Status Bar */}
      <div className="status-bar">
        <div className="status-bar-left">
          <span className={`status-indicator ${status}`} />
          <span>{status === 'compiling' ? 'Compiling...' : status === 'error' ? 'Error' : 'Ready'}</span>
        </div>
        <div className="status-bar-right">
          <span>Ln {cursorInfo.line}, Col {cursorInfo.col}</span>
          <span className="status-sep">|</span>
          <span>{wordCount} words</span>
        </div>
      </div>
    </>
  );
}

function App() {
  const [view, setView] = useState('dashboard');
  const [activeProject, setActiveProject] = useState(null);
  const [session, setSession] = useState(null);
  const [appLoading, setAppLoading] = useState(true);
  const [needsAuth, setNeedsAuth] = useState(false);
  const [vimMode, setVimMode] = useState(false);

  const [projects, setProjects] = useState({});
  const [files, setFiles] = useState({});
  const [currentFile, setCurrentFile] = useState('main.typ');
  const code = files[currentFile] || '';
  const sessionEmail = session?.user?.email || '';
  const totalStorageBytes = useMemo(
    () => Object.values(files).reduce((s, c) => s + new Blob([c]).size, 0),
    [files]
  );
  const [status, setStatus] = useState('initializing');
  const [svg, setSvg] = useState('');
  const [error, setError] = useState('');
  const [zoom, setZoom] = useState(0.75);
  const [activeSidebar, setActiveSidebar] = useState(null);
  const [editorFontSize, setEditorFontSize] = useState(15);
  const [editorFontFamily, setEditorFontFamily] = useState('"Cascadia Mono", monospace');
  const [showLineNumbers, setShowLineNumbers] = useState(true);
  const [writingDirection, setWritingDirection] = useState('ltr');
  const [ctrlSDisabled, setCtrlSDisabled] = useState(false);
  const [projectName, setProjectName] = useState('');
  const [projectLocation, setProjectLocation] = useState('black');
  const [projectFolderPath, setProjectFolderPath] = useState('');
  const [projectAccentColor, setProjectAccentColor] = useState(DASHBOARD_COLORS[0]);
  const [folders, setFolders] = useState([]);
  const [dashboardFolderPath, setDashboardFolderPath] = useState('');
  const [dashboardColor, setDashboardColor] = useState(DASHBOARD_COLORS[0]);
  const [savedIndicator, setSavedIndicator] = useState(false);
  const savedTimeoutRef = useRef(null);
  const [dialog, setDialog] = useState({ open: false });
  const dialogResolverRef = useRef(null);
  const [toasts, setToasts] = useState([]);
  const toastTimeoutsRef = useRef({});

  const [dirtyFiles, setDirtyFiles] = useState({});
  const projectsRef = useRef(projects);
  const foldersRef = useRef(folders);
  const activeProjectRef = useRef(activeProject);
  const dirtyFilesRef = useRef(dirtyFiles);

  useEffect(() => {
    projectsRef.current = projects;
  }, [projects]);

  useEffect(() => {
    foldersRef.current = folders;
  }, [folders]);

  useEffect(() => {
    activeProjectRef.current = activeProject;
  }, [activeProject]);

  useEffect(() => {
    dirtyFilesRef.current = dirtyFiles;
  }, [dirtyFiles]);

  const dismissToast = useCallback((id) => {
    if (toastTimeoutsRef.current[id]) {
      clearTimeout(toastTimeoutsRef.current[id]);
      delete toastTimeoutsRef.current[id];
    }
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const showToast = useCallback((message, tone = 'info', timeout = 3200) => {
    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    setToasts(prev => [...prev, { id, message, tone }]);
    const timeoutId = setTimeout(() => {
      dismissToast(id);
    }, timeout);
    toastTimeoutsRef.current[id] = timeoutId;
  }, [dismissToast]);

  useEffect(() => {
    return () => {
      Object.values(toastTimeoutsRef.current).forEach(clearTimeout);
    };
  }, []);

  const closeDialog = useCallback((result) => {
    if (dialogResolverRef.current) {
      dialogResolverRef.current(result);
      dialogResolverRef.current = null;
    }
    setDialog({ open: false });
  }, []);

  const openPromptDialog = useCallback((cfg) => {
    return new Promise(resolve => {
      dialogResolverRef.current = resolve;
      setDialog({ ...cfg, kind: 'prompt', open: true });
    });
  }, []);

  const openConfirmDialog = useCallback((cfg) => {
    return new Promise(resolve => {
      dialogResolverRef.current = resolve;
      setDialog({ ...cfg, kind: 'confirm', open: true });
    });
  }, []);

  const handleEditorChange = useCallback((newCode) => {
    if (files[currentFile] === newCode) return;
    const nowIso = new Date().toISOString();
    setFiles(prev => ({ ...prev, [currentFile]: newCode }));
    setDirtyFiles(prev => ({ ...prev, [currentFile]: true }));
    let stored = {};
    try { stored = JSON.parse(localStorage.getItem(STORAGE_KEY_PROJECTS)) || {}; } catch {}
    stored[activeProject] = {
      ...stored[activeProject],
      files: { ...(stored[activeProject]?.files || {}), [currentFile]: newCode },
      currentFile,
      modified: new Date().toLocaleDateString(),
      updatedAt: nowIso,
      settings: {
        fontSize: editorFontSize,
        fontFamily: editorFontFamily,
        lineNumbers: showLineNumbers,
        zoom,
        writingDirection,
        ctrlSDisabled,
        accentColor: projectAccentColor,
        folderPath: projectFolderPath,
      },
    };
    localStorage.setItem(STORAGE_KEY_PROJECTS, JSON.stringify(stored));
    syncFileToSupabase(activeProject, currentFile, newCode);
  }, [currentFile, activeProject, files, projectLocation, editorFontSize, editorFontFamily, showLineNumbers, zoom, writingDirection, ctrlSDisabled, projectAccentColor, projectFolderPath]);

  const debouncedCode = useDebounce(code, 500);

  const realtimeChannelRef = useRef(null);

  useEffect(() => {
    async function init() {
      let loaded = null;
      let activeName = null;

      if (isSupabaseReady()) {
        const { data: { session } } = await supabase.auth.getSession();
        setSession(session);
        supabase.auth.onAuthStateChange((_event, session) => setSession(session));

        // Handle password reset recovery
        if (window.location.hash?.includes('type=recovery')) {
          const newPassword = await openPromptDialog({
            title: 'Set New Password',
            message: 'Choose a new password to complete account recovery.',
            placeholder: 'New password',
            confirmLabel: 'Update Password',
            cancelLabel: 'Skip',
            minLength: 6,
            required: true,
            secret: true,
          });
          if (newPassword) {
            const { error } = await supabase.auth.updateUser({ password: newPassword });
            if (error) {
              showToast('Password reset failed: ' + error.message, 'error', 5000);
            } else {
              showToast('Password updated successfully.', 'success');
            }
          }
          window.location.hash = '';
        }

        if (session) {
          loaded = await loadProjectsFromSupabase();

          // Set up real-time subscriptions
          const channel = supabase.channel('project-changes');
          const pullLatestProjects = async () => {
            const latest = await loadProjectsFromSupabase();
            if (!latest) return;

            const activeName = activeProjectRef.current;
            const hasDirtyActiveProject = Object.keys(dirtyFilesRef.current || {}).length > 0;
            const localProjects = projectsRef.current;

            const merged = mergeProjectsByFreshness(
              localProjects,
              latest,
              activeName,
              hasDirtyActiveProject
            );

            projectsRef.current = merged;
            setProjects(merged);

            if (!activeName || hasDirtyActiveProject) return;

            const remoteActive = latest[activeName];
            const localActive = localProjects[activeName];
            if (!remoteActive) return;

            if (toTimestamp(remoteActive.updatedAt) > toTimestamp(localActive?.updatedAt)) {
              setFiles(remoteActive.files || { 'main.typ': '' });
              setCurrentFile(remoteActive.currentFile || 'main.typ');
              setProjectLocation(remoteActive.location || 'black');
              setProjectAccentColor(remoteActive.settings?.accentColor || getPaletteColor(activeName, DASHBOARD_COLORS));
              setProjectFolderPath(normalizeFolderPath(remoteActive.settings?.folderPath || ''));
              setEditorFontSize(remoteActive.settings?.fontSize || 15);
              setEditorFontFamily(remoteActive.settings?.fontFamily || '"Cascadia Mono", monospace');
              setShowLineNumbers(remoteActive.settings?.lineNumbers !== false);
              setWritingDirection(remoteActive.settings?.writingDirection || 'ltr');
              setCtrlSDisabled(remoteActive.settings?.ctrlSDisabled || false);
              setZoom(remoteActive.settings?.zoom || 0.75);
            }
          };

          channel.on('postgres_changes', {
            event: '*',
            schema: 'public',
            table: 'projects',
            filter: `user_id=eq.${session.user.id}`,
          }, (payload) => {
            if (payload.eventType === 'DELETE') {
              setProjects(prev => {
                const updated = { ...prev };
                const name = Object.keys(updated).find(k =>
                  updated[k]?.id === payload.old?.id
                );
                if (name) delete updated[name];
                projectsRef.current = updated;
                return updated;
              });
              return;
            }

            pullLatestProjects();
          });
          channel.on('postgres_changes', {
            event: '*',
            schema: 'public',
            table: 'project_files',
          }, async () => {
            await pullLatestProjects();
          });
          channel.subscribe();
          realtimeChannelRef.current = channel;
        } else {
          setNeedsAuth(true);
        }
      }

      // Fall back to localStorage if Supabase returned nothing
      if (!loaded) {
        loaded = getLocalProjects();
        activeName = getLocalActiveProject();
      }

      const storedFolders = getLocalFolders();
      const mergedFolderResult = mergeFolderList(storedFolders, loaded, DASHBOARD_COLORS);
      setFolders(mergedFolderResult.folders);
      foldersRef.current = mergedFolderResult.folders;
      if (mergedFolderResult.changed || (storedFolders || []).length !== mergedFolderResult.folders.length) {
        setLocalFolders(mergedFolderResult.folders);
      }

      setProjects(loaded);

      if (activeName && loaded[activeName]) {
        openProject(activeName);
      } else if (Object.keys(loaded).length > 0) {
        openProject(Object.keys(loaded)[0]);
      }

      setAppLoading(false);
    }
    init();

    return () => {
      realtimeChannelRef.current?.unsubscribe();
    };
  }, [openPromptDialog, showToast]);

  const persistProjects = useCallback((updated) => {
    const projs = updated || projects;
    localStorage.setItem(STORAGE_KEY_PROJECTS, JSON.stringify(projs));
  }, [projects]);

  const openProject = useCallback((name, projectOverride = null) => {
    const p = projectOverride || projects[name];
    if (!p) return;
    setActiveProject(name);
    setFiles(p.files || { 'main.typ': '' });
    setCurrentFile(p.currentFile || 'main.typ');
    setProjectName(name);
    setProjectLocation(p.location || 'black');
    setProjectAccentColor(p.settings?.accentColor || getPaletteColor(name, DASHBOARD_COLORS));
    setProjectFolderPath(normalizeFolderPath(p.settings?.folderPath || ''));
    setEditorFontSize(p.settings?.fontSize || 15);
    setEditorFontFamily(p.settings?.fontFamily || '"Cascadia Mono", monospace');
    setShowLineNumbers(p.settings?.lineNumbers !== false);
    setWritingDirection(p.settings?.writingDirection || 'ltr');
    setCtrlSDisabled(p.settings?.ctrlSDisabled || false);
    setZoom(p.settings?.zoom || 0.75);
    setDirtyFiles({});
    setSvg('');
    setError('');
    setStatus('ready');
    setActiveSidebar('settings');
    setView('editor');
    setLocalActiveProject(name);
  }, [projects]);

  const saveProject = useCallback(() => {
    const nowIso = new Date().toISOString();
    setProjects(prev => {
      const updated = {
        ...prev,
        [activeProject]: {
          ...prev[activeProject],
          files,
          currentFile,
          location: projectLocation,
          modified: new Date().toLocaleDateString(),
          updatedAt: nowIso,
          settings: {
            fontSize: editorFontSize,
            fontFamily: editorFontFamily,
            lineNumbers: showLineNumbers,
            writingDirection,
            ctrlSDisabled,
            zoom,
            accentColor: projectAccentColor,
            folderPath: projectFolderPath,
          },
        },
      };
      localStorage.setItem(STORAGE_KEY_PROJECTS, JSON.stringify(updated));
      projectsRef.current = updated;
      syncProjectsToSupabase(updated);
      return updated;
    });
    setDirtyFiles({});
    setSavedIndicator(true);
    if (savedTimeoutRef.current) clearTimeout(savedTimeoutRef.current);
    savedTimeoutRef.current = setTimeout(() => setSavedIndicator(false), 1500);
  }, [activeProject, currentFile, files, projectLocation, editorFontSize, editorFontFamily, showLineNumbers, zoom, writingDirection, ctrlSDisabled, projectAccentColor, projectFolderPath]);

  const createProject = useCallback((name, options = {}) => {
    const n = typeof name === 'string' && name.trim()
      ? name.trim()
      : `project-${Date.now()}`;
    const accentColor = options.accentColor || getPaletteColor(n, DASHBOARD_COLORS);
    const folderPath = normalizeFolderPath(options.folderPath || '');
    const nowIso = new Date().toISOString();
    const newProject = {
      name: n,
      location: 'black',
      files: { 'main.typ': DEFAULT_CODE },
      currentFile: 'main.typ',
      createdAt: nowIso,
      updatedAt: nowIso,
      modified: new Date().toLocaleDateString(),
      settings: {
        fontSize: 15,
        fontFamily: '"Cascadia Mono", monospace',
        lineNumbers: true,
        writingDirection: 'ltr',
        ctrlSDisabled: false,
        zoom: 0.75,
        accentColor,
        folderPath,
      },
    };
    setProjects(prev => {
      const updated = { ...prev, [n]: newProject };
      localStorage.setItem(STORAGE_KEY_PROJECTS, JSON.stringify(updated));
      projectsRef.current = updated;
      syncProjectsToSupabase(updated);
      const merged = mergeFolderList(foldersRef.current, updated, DASHBOARD_COLORS);
      if (merged.changed || (foldersRef.current || []).length !== merged.folders.length) {
        setFolders(merged.folders);
        setLocalFolders(merged.folders);
        foldersRef.current = merged.folders;
      }
      return updated;
    });
    if (options.open !== false) {
      openProject(n, newProject);
    }
    return newProject;
  }, [openProject]);

  const createProjectFromDashboard = useCallback(() => {
    (async () => {
      const defaultName = `project-${Date.now()}`;
      const rawName = await openPromptDialog({
        title: 'Create Project',
        message: 'Name your project to add it to the dashboard.',
        defaultValue: defaultName,
        placeholder: 'project-name',
        confirmLabel: 'Create',
        cancelLabel: 'Cancel',
        required: true,
      });
      const name = typeof rawName === 'string' ? rawName.trim() : '';
      if (!name) return;
      if (projectsRef.current[name]) {
        showToast('A project with that name already exists.', 'error');
        return;
      }
      createProject(name, { open: false, accentColor: dashboardColor, folderPath: dashboardFolderPath });
      showToast(`Created project "${name}".`, 'success');
    })();
  }, [createProject, dashboardColor, dashboardFolderPath, openPromptDialog, showToast]);

  const updateFolderStore = useCallback((nextFolders) => {
    setFolders(nextFolders);
    setLocalFolders(nextFolders);
    foldersRef.current = nextFolders;
  }, []);

  const openDashboardFolder = useCallback((path) => {
    setDashboardFolderPath(normalizeFolderPath(path));
  }, []);

  const goToDashboardParent = useCallback(() => {
    setDashboardFolderPath(prev => getParentPath(prev));
  }, []);

  const createFolderFromDashboard = useCallback(() => {
    (async () => {
      const basePath = normalizeFolderPath(dashboardFolderPath);
      const rawName = await openPromptDialog({
        title: 'Create Folder',
        message: basePath
          ? `Create a subfolder in "${basePath}".`
          : 'Create a new folder on the dashboard.',
        defaultValue: 'New folder',
        placeholder: 'folder-name',
        confirmLabel: 'Create Folder',
        cancelLabel: 'Cancel',
        required: true,
      });

      const name = normalizeFolderPath(rawName);
      if (!name) return;
      const combinedPath = normalizeFolderPath(basePath ? `${basePath}/${name}` : name);
      if (!combinedPath) return;

      const existingPaths = new Set((foldersRef.current || []).map(folder => normalizeFolderPath(folder.path)));
      if (existingPaths.has(combinedPath)) {
        showToast('A folder with that name already exists.', 'error');
        return;
      }

      const nowIso = new Date().toISOString();
      const nextFolders = [...(foldersRef.current || [])];
      const parts = combinedPath.split('/').filter(Boolean);
      for (let i = 0; i < parts.length; i++) {
        const path = parts.slice(0, i + 1).join('/');
        if (existingPaths.has(path)) continue;
        nextFolders.push({
          path,
          name: getPathLabel(path),
          color: getPaletteColor(path, DASHBOARD_COLORS),
          createdAt: nowIso,
          updatedAt: nowIso,
        });
        existingPaths.add(path);
      }

      updateFolderStore(nextFolders);
      showToast(`Created folder "${getPathLabel(combinedPath)}".`, 'success');
    })();
  }, [dashboardFolderPath, openPromptDialog, showToast, updateFolderStore]);

  const moveProjectToFolder = useCallback((name, targetPath) => {
    const normalizedTarget = normalizeFolderPath(targetPath);
    setProjects(prev => {
      const project = prev[name];
      if (!project) return prev;
      const currentPath = normalizeFolderPath(project.settings?.folderPath || '');
      if (currentPath === normalizedTarget) return prev;
      const updatedProject = {
        ...project,
        settings: { ...project.settings, folderPath: normalizedTarget },
      };
      const updated = { ...prev, [name]: updatedProject };
      localStorage.setItem(STORAGE_KEY_PROJECTS, JSON.stringify(updated));
      projectsRef.current = updated;
      syncProjectsToSupabase(updated);

      const merged = mergeFolderList(foldersRef.current, updated, DASHBOARD_COLORS);
      if (merged.changed || (foldersRef.current || []).length !== merged.folders.length) {
        updateFolderStore(merged.folders);
      }

      return updated;
    });

    if (activeProjectRef.current === name) {
      setProjectFolderPath(normalizedTarget);
    }
  }, [updateFolderStore]);

  const dashboardFolders = useMemo(() => {
    const currentPath = normalizeFolderPath(dashboardFolderPath);
    const prefix = currentPath ? `${currentPath}/` : '';
    return (folders || []).filter(folder => {
      const path = normalizeFolderPath(folder.path);
      if (!path) return false;
      if (!currentPath) return !path.includes('/');
      if (!path.startsWith(prefix)) return false;
      const rest = path.slice(prefix.length);
      return rest && !rest.includes('/');
    });
  }, [folders, dashboardFolderPath]);

  const dashboardProjects = useMemo(() => {
    const currentPath = normalizeFolderPath(dashboardFolderPath);
    return Object.values(projects).filter(project =>
      normalizeFolderPath(project.settings?.folderPath || '') === currentPath
    );
  }, [projects, dashboardFolderPath]);

  const deleteProject = useCallback((name) => {
    setProjects(prev => {
      const updated = { ...prev };
      delete updated[name];
      localStorage.setItem(STORAGE_KEY_PROJECTS, JSON.stringify(updated));
      projectsRef.current = updated;
      syncProjectDeleteToSupabase(name);
      return updated;
    });
  }, []);

  const goToDashboard = useCallback(() => {
    saveProject();
    setView('dashboard');
    setActiveProject(null);
    removeLocalActiveProject();
  }, [saveProject]);

  const renameFile = useCallback((oldName) => {
    (async () => {
      const newName = await openPromptDialog({
        title: 'Rename File',
        message: `Rename ${oldName} to:`,
        defaultValue: oldName,
        placeholder: 'new-file.typ',
        confirmLabel: 'Rename',
        cancelLabel: 'Cancel',
        required: true,
      });
      const normalizedNewName = normalizeFilePath(newName);
      if (!normalizedNewName || normalizedNewName === oldName) return;
      const nowIso = new Date().toISOString();
      let duplicate = false;
      setFiles(prev => {
        if (prev[normalizedNewName]) {
          duplicate = true;
          return prev;
        }
        const updated = { ...prev };
        updated[normalizedNewName] = prev[oldName];
        delete updated[oldName];
        let stored = {};
        try { stored = JSON.parse(localStorage.getItem(STORAGE_KEY_PROJECTS)) || {}; } catch {}
        const nextFile = oldName === currentFile ? normalizedNewName : currentFile;
        stored[activeProject] = {
          ...stored[activeProject],
          files: updated,
          currentFile: nextFile,
          modified: new Date().toLocaleDateString(),
          updatedAt: nowIso,
        };
        localStorage.setItem(STORAGE_KEY_PROJECTS, JSON.stringify(stored));
        syncFileRenameToSupabase(activeProject, oldName, normalizedNewName);
        return updated;
      });
      if (duplicate) {
        showToast('A file with that name already exists.', 'error');
        return;
      }
      if (oldName === currentFile) {
        setCurrentFile(normalizedNewName);
      }
    })();
  }, [currentFile, activeProject, openPromptDialog, showToast]);

  const handleDeleteProject = useCallback(() => {
    (async () => {
      const confirmed = await openConfirmDialog({
        title: 'Delete Project',
        message: `Delete project "${projectName}"? This cannot be undone.`,
        confirmLabel: 'Delete Project',
        cancelLabel: 'Cancel',
        danger: true,
      });
      if (!confirmed) return;
      deleteProject(projectName);
      setView('dashboard');
      setActiveProject(null);
      removeLocalActiveProject();
      showToast(`Project "${projectName}" deleted.`, 'success');
    })();
  }, [deleteProject, projectName, openConfirmDialog, showToast]);

  const addFile = useCallback((folderPath = '') => {
    (async () => {
      const normalizedFolder = normalizeFolderPath(folderPath);
      const defaultName = normalizedFolder ? `${normalizedFolder}/untitled.typ` : 'untitled.typ';
      const rawName = await openPromptDialog({
        title: 'Create File',
        message: normalizedFolder
          ? `Add a new file inside "${normalizedFolder}".`
          : 'Add a new file to this project.',
        defaultValue: defaultName,
        placeholder: 'file.typ',
        confirmLabel: 'Create',
        cancelLabel: 'Cancel',
        required: true,
      });
      let name = normalizeFilePath(rawName);
      if (!name) return;
      if (normalizedFolder && !name.startsWith(`${normalizedFolder}/`)) {
        name = normalizeFilePath(`${normalizedFolder}/${getPathLabel(name)}`);
      }
      if (!name) return;
      const nowIso = new Date().toISOString();
      const currentBytes = Object.values(files).reduce((s, c) => s + new Blob([c]).size, 0);
      if (currentBytes >= MAX_STORAGE_BYTES) {
        showToast('Storage limit reached. Delete some files first.', 'error', 5000);
        return;
      }
      let duplicate = false;
      setFiles(prev => {
        if (prev[name]) {
          duplicate = true;
          return prev;
        }
        const updated = { ...prev, [name]: '' };
        let stored = {};
        try { stored = JSON.parse(localStorage.getItem(STORAGE_KEY_PROJECTS)) || {}; } catch {}
        stored[activeProject] = {
          ...stored[activeProject],
          files: updated,
          currentFile: name,
          modified: new Date().toLocaleDateString(),
          updatedAt: nowIso,
        };
        localStorage.setItem(STORAGE_KEY_PROJECTS, JSON.stringify(stored));
        syncFileAddToSupabase(activeProject, name);
        return updated;
      });
      if (duplicate) {
        showToast('A file with that name already exists.', 'error');
        return;
      }
      setCurrentFile(name);
    })();
  }, [activeProject, files, openPromptDialog, showToast]);

  const addFolder = useCallback(() => {
    (async () => {
      const rawFolder = await openPromptDialog({
        title: 'Create Folder',
        message: 'Create a folder to group existing files.',
        defaultValue: 'sections',
        placeholder: 'chapters',
        confirmLabel: 'Create Folder',
        cancelLabel: 'Cancel',
        required: true,
      });

      const folder = normalizeFolderPath(rawFolder);
      if (!folder) return;

      const rootFiles = Object.keys(files).filter(name => !name.includes('/'));
      if (rootFiles.length === 0) {
        showToast('No root-level files to move. Create a file like "folder/name.typ" to populate the folder.', 'info');
        return;
      }

      const nowIso = new Date().toISOString();
      const updated = { ...files };
      const renameMap = {};

      rootFiles.forEach((oldPath) => {
        const desired = `${folder}/${oldPath}`;
        const unique = getUniqueFilePath(updated, desired);
        renameMap[oldPath] = unique;
        updated[unique] = updated[oldPath];
        delete updated[oldPath];
      });

      const nextCurrentFile = renameMap[currentFile] || currentFile;

      setFiles(updated);
      setCurrentFile(nextCurrentFile);
      setDirtyFiles(prev => {
        const next = { ...prev };
        Object.entries(renameMap).forEach(([oldName, newName]) => {
          if (next[oldName]) {
            next[newName] = next[oldName];
            delete next[oldName];
          }
        });
        return next;
      });

      let stored = {};
      try { stored = JSON.parse(localStorage.getItem(STORAGE_KEY_PROJECTS)) || {}; } catch {}
      stored[activeProject] = {
        ...stored[activeProject],
        files: updated,
        currentFile: nextCurrentFile,
        modified: new Date().toLocaleDateString(),
        updatedAt: nowIso,
      };
      localStorage.setItem(STORAGE_KEY_PROJECTS, JSON.stringify(stored));

      Object.entries(renameMap).forEach(([oldName, newName]) => {
        syncFileRenameToSupabase(activeProject, oldName, newName);
      });

      showToast(`Moved ${rootFiles.length} file${rootFiles.length === 1 ? '' : 's'} into "${folder}".`, 'success');
    })();
  }, [activeProject, currentFile, files, openPromptDialog, showToast]);

  const deleteFileCallback = useCallback((name) => {
    (async () => {
      const confirmed = await openConfirmDialog({
        title: 'Delete File',
        message: `Delete "${name}"?`,
        confirmLabel: 'Delete File',
        cancelLabel: 'Cancel',
        danger: true,
      });
      if (!confirmed) return;
      const nowIso = new Date().toISOString();
      let blocked = false;
      setFiles(prev => {
        const keys = Object.keys(prev);
        if (keys.length <= 1) {
          blocked = true;
          return prev;
        }
        const updated = { ...prev };
        delete updated[name];
        let stored = {};
        try { stored = JSON.parse(localStorage.getItem(STORAGE_KEY_PROJECTS)) || {}; } catch {}
        const nextFile = name === currentFile ? keys.find(k => k !== name) || currentFile : currentFile;
        stored[activeProject] = {
          ...stored[activeProject],
          files: updated,
          currentFile: nextFile,
          modified: new Date().toLocaleDateString(),
          updatedAt: nowIso,
        };
        localStorage.setItem(STORAGE_KEY_PROJECTS, JSON.stringify(stored));
        syncFileDeleteToSupabase(activeProject, name);
        return updated;
      });
      if (blocked) {
        showToast('A project must have at least one file.', 'error');
        return;
      }
      setCurrentFile(prev => {
        if (prev !== name) return prev;
        return Object.keys(files).filter(k => k !== name)[0] || prev;
      });
    })();
  }, [files, currentFile, activeProject, openConfirmDialog, showToast]);

  const extractOutline = useCallback((source) => {
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
  }, []);

  const getCursorInfo = useCallback((viewRef) => {
    const view = viewRef?.current;
    if (!view) return { line: 1, col: 1 };
    const pos = view.state.selection.main.head;
    try {
      const line = view.state.doc.lineAt(pos);
      return { line: line.number, col: pos - line.from + 1 };
    } catch {
      return { line: 1, col: 1 };
    }
  }, []);

  const getWordCount = useCallback((source) => {
    return source?.trim() ? source.split(/\s+/).length : 0;
  }, []);

  const gotoLine = useCallback((line, viewRef) => {
    // handled inside EditorViewInner via outline
  }, []);

  const handleLogout = useCallback(async () => {
    await supabase.auth.signOut();
    setSession(null);
    setView('dashboard');
    setActiveProject(null);
    removeLocalActiveProject();
    window.location.reload();
  }, []);

  let content = null;

  if (appLoading) {
    content = (
      <div className="app-loading">
        <div className="auth-brand">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="4 7 4 4 20 4 20 7" />
            <line x1="9" y1="20" x2="15" y2="20" />
            <line x1="12" y1="4" x2="12" y2="20" />
          </svg>
          <span>Typst</span>
        </div>
      </div>
    );
  } else if (needsAuth && !session) {
    content = <Auth />;
  } else if (view === 'dashboard') {
    content = (
      <DashboardView
        projects={dashboardProjects}
        folders={dashboardFolders}
        currentFolderPath={dashboardFolderPath}
        onOpenProject={openProject}
        onCreateProject={createProjectFromDashboard}
        onCreateFolder={createFolderFromDashboard}
        onOpenFolder={openDashboardFolder}
        onMoveProjectToFolder={moveProjectToFolder}
        onGoToParent={goToDashboardParent}
        onDeleteProject={deleteProject}
        onStartFromGitLab={() => showToast('Start from GitLab is coming soon.', 'info')}
        sessionEmail={sessionEmail}
        onLogout={handleLogout}
        colorOptions={DASHBOARD_COLORS}
        selectedColor={dashboardColor}
        onSelectColor={setDashboardColor}
      />
    );
  } else {
    content = (
      <div className="ide">
        <EditorViewInner
          files={files}
          currentFile={currentFile}
          setCurrentFile={setCurrentFile}
          code={code}
          onCodeChange={handleEditorChange}
          status={status}
          setStatus={setStatus}
          svg={svg}
          setSvg={setSvg}
          error={error}
          setError={setError}
          zoom={zoom}
          setZoom={setZoom}
          editorFontSize={editorFontSize}
          setEditorFontSize={setEditorFontSize}
          editorFontFamily={editorFontFamily}
          setEditorFontFamily={setEditorFontFamily}
          showLineNumbers={showLineNumbers}
          setShowLineNumbers={setShowLineNumbers}
          writingDirection={writingDirection}
          setWritingDirection={setWritingDirection}
          ctrlSDisabled={ctrlSDisabled}
          setCtrlSDisabled={setCtrlSDisabled}
          vimMode={vimMode}
          setVimMode={setVimMode}
          projectName={projectName}
          projectLocation={projectLocation}
          savedIndicator={savedIndicator}
          onBack={goToDashboard}
          onPersist={saveProject}
          addFile={addFile}
          addFolder={addFolder}
          deleteFile={deleteFileCallback}
          renameFile={renameFile}
          dirtyFiles={dirtyFiles}
          onDeleteProject={handleDeleteProject}
          exportFormat={null}
          getCursorInfo={getCursorInfo}
          getWordCount={getWordCount}
          extractOutline={extractOutline}
          gotoLine={gotoLine}
          activeSidebar={activeSidebar}
          setActiveSidebar={setActiveSidebar}
          debouncedCode={debouncedCode}
          totalStorageBytes={totalStorageBytes}
          maxStorageBytes={MAX_STORAGE_BYTES}
          formatBytes={formatBytes}
          sessionEmail={sessionEmail}
          onLogout={handleLogout}
        />
      </div>
    );
  }

  return (
    <>
      {content}
      <AppDialog
        dialog={dialog}
        onCancel={() => closeDialog(null)}
        onConfirm={closeDialog}
      />
      <ToastStack toasts={toasts} onDismiss={dismissToast} />
    </>
  );
}

export default App;
