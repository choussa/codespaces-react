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
  Folder, Search, Map, PenTool, Settings, Globe, HelpCircle,
  ChevronRight, Cloud, MoreHorizontal, Minus, Plus, Square,
  Check, Type, Bold, Italic, Underline, Heading, List, ListOrdered,
  Sigma, Code, AtSign, MessageSquare, ChevronDown, FilePlus,
  Trash2, ArrowLeft, Pencil, LogOut, User
} from 'lucide-react';
import DashboardView from './components/DashboardView';
import DownloadDropdown from './components/DownloadDropdown';
import Auth from './components/Auth';
import {
  getLocalProjects, getLocalActiveProject, setLocalActiveProject, removeLocalActiveProject,
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

const ZOOM_STEP = 0.25;
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 4;
const PAPER_W = 580;
const PAPER_H = 780;
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
  onBack, onPersist, addFile, deleteFile, renameFile, dirtyFiles, onDeleteProject, exportFormat,
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
  const editorRef = useRef(null);
  const viewRef = useRef(null);
  const prevCodeRef = useRef('');
  const themeCompartment = useRef(new Compartment());
  const lineNumbersCompartment = useRef(new Compartment());
  const dirCompartment = useRef(new Compartment());
  const vimCompartment = useRef(new Compartment());
  const previewBodyRef = useRef(null);
  const pinchRef = useRef(null);

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

    el.addEventListener('touchstart', onTouchStart, { passive: false });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd);

    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
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
                  <select value={projectLocation}>
                    <option>black</option>
                    <option>white</option>
                  </select>
                  <ChevronDown className="select-chevron" size={16} />
                </div>
              </div>
              <div className="sidebar-field">
                <label>Compiler</label>
                <div className="select-wrap">
                  <select>
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
              <button onClick={onDeleteProject}>
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
            <button className="sidebar-header-btn" onClick={addFile} title="New file">
              <FilePlus size={16} />
            </button>
          </div>
          <div className="sidebar-body">
            <div className="sidebar-section">
              {Object.keys(files).map(name => (
                <div key={name} className="sidebar-file-row">
                  <span
                    className={`sidebar-file ${currentFile === name ? 'active' : ''}`}
                    onClick={() => setCurrentFile(name)}
                  >
                    {dirtyFiles[name] && <span className="file-dirty-dot" />}
                    {name}
                  </span>
                  <div className="sidebar-file-actions">
                    {Object.keys(files).length > 1 && (
                      <button className="sidebar-file-btn" onClick={() => renameFile(name)} title="Rename file">
                        <Pencil size={12} />
                      </button>
                    )}
                    {Object.keys(files).length > 1 && (
                      <button className="sidebar-file-btn sidebar-file-del" onClick={() => deleteFile(name)} title="Delete file">
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
          <div className="top-nav-back" onClick={onBack}>
            <ChevronRight size={16} className="rotate-180" />
            <span>Typst</span>
          </div>
          <div className="top-nav-menu">
            <span>File</span>
            <span>Edit</span>
            <span>View</span>
            <span>Help</span>
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
      <div className="workspace">
        {/* Activity Bar */}
        <div className="activity-bar">
          <div className="activity-bar-top">
            {[
              { id: 'files', icon: Folder },
              { id: 'search', icon: Search },
              { id: 'outline', icon: Map },
              { id: 'pen', icon: PenTool, badge: 5 },
              { id: 'settings', icon: Settings },
              { id: 'globe', icon: Globe },
            ].map(item => (
              <button
                key={item.id}
                className={`activity-btn ${activeSidebar === item.id ? 'active' : ''}`}
                onClick={() => setActiveSidebar(activeSidebar === item.id ? null : item.id)}
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
                <button className="activity-btn activity-logout" onClick={onLogout} title="Sign out">
                  <LogOut size={16} />
                </button>
              </div>
            )}
            <button className="activity-btn"><HelpCircle size={20} /></button>
            <div className="activity-brand">typst</div>
          </div>
        </div>

        {/* Sidebar Panel */}
        {activeSidebar && <div className="sidebar">{renderSidebarContent()}</div>}

        {/* Editor Pane */}
        <div className="editor-pane">
          <div className="editor-toolbar">
            {toolbarButtons.map((btn, i) => (
              <button key={i} className="editor-toolbar-btn" onClick={toolbarActions[btn.action]} title={btn.action}>
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
              <button className="preview-toolbar-btn"><ChevronRight size={16} className="rotate-180" /></button>
            </div>
            <div className="preview-zoom">
              <button onClick={() => setZoom(z => Math.max(ZOOM_MIN, z - ZOOM_STEP))}><Minus size={14} /></button>
              <span>{Math.round(zoom * 100)}%</span>
              <button onClick={() => setZoom(z => Math.min(ZOOM_MAX, z + ZOOM_STEP))}><Plus size={14} /></button>
              <div className="preview-zoom-divider" />
              <button onClick={() => setZoom(1)}><Square size={12} /></button>
            </div>
            <div className="preview-toolbar-right">
              <DownloadDropdown onExport={handleExport} disabled={!debouncedCode.trim()} />
              <button className="preview-toolbar-btn"><MoreHorizontal size={16} /></button>
            </div>
          </div>
          <div className={`preview-body${zoom > 1 ? ' preview-body--zoomed' : ''}`} ref={previewBodyRef}>
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
  const [savedIndicator, setSavedIndicator] = useState(false);
  const savedTimeoutRef = useRef(null);

  const [dirtyFiles, setDirtyFiles] = useState({});

  const handleEditorChange = useCallback((newCode) => {
    if (files[currentFile] === newCode) return;
    setFiles(prev => ({ ...prev, [currentFile]: newCode }));
    setDirtyFiles(prev => ({ ...prev, [currentFile]: true }));
    let stored = {};
    try { stored = JSON.parse(localStorage.getItem(STORAGE_KEY_PROJECTS)) || {}; } catch {}
    stored[activeProject] = {
      ...stored[activeProject],
      files: { ...(stored[activeProject]?.files || {}), [currentFile]: newCode },
      currentFile,
      modified: new Date().toLocaleDateString(),
      settings: { fontSize: editorFontSize, fontFamily: editorFontFamily, lineNumbers: showLineNumbers, zoom, writingDirection, ctrlSDisabled },
    };
    localStorage.setItem(STORAGE_KEY_PROJECTS, JSON.stringify(stored));
    syncFileToSupabase(activeProject, currentFile, newCode);
  }, [currentFile, activeProject, files, projectLocation, editorFontSize, editorFontFamily, showLineNumbers, zoom, writingDirection, ctrlSDisabled]);

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
          const newPassword = prompt('Enter your new password (min 6 characters):');
          if (newPassword && newPassword.length >= 6) {
            const { error } = await supabase.auth.updateUser({ password: newPassword });
            if (error) {
              alert('Password reset failed: ' + error.message);
            } else {
              alert('Password updated successfully!');
            }
          }
          window.location.hash = '';
        }

        if (session) {
          loaded = await loadProjectsFromSupabase();

          // Set up real-time subscriptions
          const channel = supabase.channel('project-changes');
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
                return updated;
              });
            }
          });
          channel.on('postgres_changes', {
            event: '*',
            schema: 'public',
            table: 'project_files',
          }, async (payload) => {
            await loadProjectsFromSupabase().then(latest => {
              if (latest) setProjects(prev => ({ ...prev, ...latest }));
            });
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
  }, []);

  const persistProjects = useCallback((updated) => {
    const projs = updated || projects;
    localStorage.setItem(STORAGE_KEY_PROJECTS, JSON.stringify(projs));
  }, [projects]);

  const openProject = useCallback((name) => {
    const p = projects[name];
    if (!p) return;
    setActiveProject(name);
    setFiles(p.files || { 'main.typ': '' });
    setCurrentFile(p.currentFile || 'main.typ');
    setProjectName(name);
    setProjectLocation(p.location || 'black');
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
    setProjects(prev => {
      const updated = {
        ...prev,
        [activeProject]: {
          ...prev[activeProject],
          files,
          currentFile,
          location: projectLocation,
          modified: new Date().toLocaleDateString(),
          settings: {
            fontSize: editorFontSize,
            fontFamily: editorFontFamily,
            lineNumbers: showLineNumbers,
            writingDirection,
            ctrlSDisabled,
            zoom,
          },
        },
      };
      localStorage.setItem(STORAGE_KEY_PROJECTS, JSON.stringify(updated));
      syncProjectsToSupabase(updated);
      return updated;
    });
    setDirtyFiles({});
    setSavedIndicator(true);
    if (savedTimeoutRef.current) clearTimeout(savedTimeoutRef.current);
    savedTimeoutRef.current = setTimeout(() => setSavedIndicator(false), 1500);
  }, [activeProject, currentFile, files, projectLocation, editorFontSize, editorFontFamily, showLineNumbers, zoom, writingDirection, ctrlSDisabled]);

  const createProject = useCallback((name) => {
    const n = name || `project-${Date.now()}`;
    const newProject = {
      name: n,
      location: 'black',
      files: { 'main.typ': DEFAULT_CODE },
      currentFile: 'main.typ',
      modified: new Date().toLocaleDateString(),
      settings: { fontSize: 15, fontFamily: '"Cascadia Mono", monospace', lineNumbers: true, writingDirection: 'ltr', ctrlSDisabled: false, zoom: 0.75 },
    };
    setProjects(prev => {
      const updated = { ...prev, [n]: newProject };
      localStorage.setItem(STORAGE_KEY_PROJECTS, JSON.stringify(updated));
      syncProjectsToSupabase(updated);
      return updated;
    });
    openProject(n);
  }, [openProject]);

  const deleteProject = useCallback((name) => {
    setProjects(prev => {
      const updated = { ...prev };
      delete updated[name];
      localStorage.setItem(STORAGE_KEY_PROJECTS, JSON.stringify(updated));
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
    const newName = prompt('Rename file:', oldName);
    if (!newName || newName === oldName) return;
    setFiles(prev => {
      if (prev[newName]) {
        alert('A file with that name already exists.');
        return prev;
      }
      const updated = { ...prev };
      updated[newName] = prev[oldName];
      delete updated[oldName];
      let stored = {};
      try { stored = JSON.parse(localStorage.getItem(STORAGE_KEY_PROJECTS)) || {}; } catch {}
      const nextFile = oldName === currentFile ? newName : currentFile;
      stored[activeProject] = {
        ...stored[activeProject],
        files: updated,
        currentFile: nextFile,
        modified: new Date().toLocaleDateString(),
      };
      localStorage.setItem(STORAGE_KEY_PROJECTS, JSON.stringify(stored));
      syncFileRenameToSupabase(activeProject, oldName, newName);
      return updated;
    });
    if (oldName === currentFile) {
      setCurrentFile(newName);
    }
  }, [files, currentFile, activeProject]);

  const handleDeleteProject = useCallback(() => {
    if (!confirm(`Delete project "${projectName}"? This cannot be undone.`)) return;
    deleteProject(projectName);
    setView('dashboard');
    setActiveProject(null);
    removeLocalActiveProject();
  }, [deleteProject, projectName]);

  const addFile = useCallback(() => {
    const name = prompt('File name:', 'untitled.typ');
    if (!name) return;
    const currentBytes = Object.values(files).reduce((s, c) => s + new Blob([c]).size, 0);
    if (currentBytes >= MAX_STORAGE_BYTES) {
      alert('Storage limit of ' + formatBytes(MAX_STORAGE_BYTES) + ' reached. Please delete some files first.');
      return;
    }
    setFiles(prev => {
      if (prev[name]) return prev;
      const updated = { ...prev, [name]: '' };
      let stored = {};
      try { stored = JSON.parse(localStorage.getItem(STORAGE_KEY_PROJECTS)) || {}; } catch {}
      stored[activeProject] = {
        ...stored[activeProject],
        files: updated,
        currentFile: name,
        modified: new Date().toLocaleDateString(),
      };
      localStorage.setItem(STORAGE_KEY_PROJECTS, JSON.stringify(stored));
      syncFileAddToSupabase(activeProject, name);
      return updated;
    });
    setCurrentFile(name);
  }, [activeProject]);

  const deleteFileCallback = useCallback((name) => {
    if (!confirm(`Delete "${name}"?`)) return;
    setFiles(prev => {
      const keys = Object.keys(prev);
      if (keys.length <= 1) return prev;
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
      };
      localStorage.setItem(STORAGE_KEY_PROJECTS, JSON.stringify(stored));
      syncFileDeleteToSupabase(activeProject, name);
      return updated;
    });
    setCurrentFile(prev => {
      if (prev !== name) return prev;
      return Object.keys(files).filter(k => k !== name)[0] || prev;
    });
  }, [files, currentFile, activeProject]);

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

  if (appLoading) {
    return (
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
  }

  if (needsAuth && !session) {
    return <Auth />;
  }

  if (view === 'dashboard') {
    return (
      <DashboardView
        projects={projects}
        onOpenProject={openProject}
        onCreateProject={createProject}
        onDeleteProject={deleteProject}
        sessionEmail={sessionEmail}
        onLogout={handleLogout}
      />
    );
  }

  return (
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

export default App;
