import { useState, useEffect, useRef } from 'react';
import { $typst } from '@myriaddreamin/typst.ts';
import { EditorView, basicSetup } from 'codemirror';
import { markdown } from '@codemirror/lang-markdown';
import { oneDark } from '@codemirror/theme-one-dark';
import {
  Folder, Search, Map, PenTool, Settings, Globe, HelpCircle,
  ChevronRight, Cloud, Share, MoreHorizontal, Minus, Plus, Square,
  Check, Type, Bold, Italic, Underline, Heading, List, ListOrdered,
  Sigma, Code, AtSign, MessageSquare, ChevronDown
} from 'lucide-react';

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

function App() {
  const [code, setCode] = useState(DEFAULT_CODE);
  const [status, setStatus] = useState('initializing');
  const [svg, setSvg] = useState('');
  const [error, setError] = useState('');
  const [zoom, setZoom] = useState(0.75);
  const [activeSidebar, setActiveSidebar] = useState('settings');
  const [editorFontSize, setEditorFontSize] = useState(15);
  const [editorFontFamily, setEditorFontFamily] = useState('"Cascadia Mono", monospace');
  const [lineNumbers, setLineNumbers] = useState(true);
  const [vimMode, setVimMode] = useState(false);
  const [projectName, setProjectName] = useState('blank3');
  const [projectLocation, setProjectLocation] = useState('black');

  const editorRef = useRef(null);
  const viewRef = useRef(null);
  const prevCodeRef = useRef('');
  const debouncedCode = useDebounce(code, 500);

  useEffect(() => {
    $typst.setCompilerInitOptions({
      getModule: () => '/wasm/typst_ts_web_compiler_bg.wasm',
    });
    $typst.setRendererInitOptions({
      getModule: () => '/wasm/typst_ts_renderer_bg.wasm',
    });
    setStatus('ready');
  }, []);

  useEffect(() => {
    if (!editorRef.current || viewRef.current) return;

    const updateListener = EditorView.updateListener.of(v => {
      if (v.docChanged) {
        setCode(v.state.doc.toString());
      }
    });

    viewRef.current = new EditorView({
      doc: code,
      extensions: [
        basicSetup,
        markdown(),
        oneDark,
        updateListener,
      ],
      parent: editorRef.current,
    });

    return () => {
      viewRef.current?.destroy();
      viewRef.current = null;
    };
  }, []);

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
  }, [debouncedCode]);

  const sidebarContent = (
    <div className="sidebar-panel">
      <div className="sidebar-header">
        <h2>Settings</h2>
      </div>
      <div className="sidebar-body">
        <div className="sidebar-section">
          <h3>Project settings</h3>
          <div className="sidebar-field">
            <label>Name</label>
            <input type="text" value={projectName} onChange={e => setProjectName(e.target.value)} />
          </div>
          <div className="sidebar-field">
            <label>Location</label>
            <div className="select-wrap">
              <select value={projectLocation} onChange={e => setProjectLocation(e.target.value)}>
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
            <label>Font size in the editor</label>
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
              <select value={lineNumbers ? 'Normal' : 'Off'} onChange={e => setLineNumbers(e.target.value === 'Normal')}>
                <option>Normal</option>
                <option>Off</option>
              </select>
              <ChevronDown className="select-chevron" size={16} />
            </div>
          </div>
          <label className="sidebar-toggle">
            <span>Show line numbers in search results</span>
            <div className="checkbox checked"><Check size={12} /></div>
          </label>
          <div className="sidebar-field">
            <label>Writing direction</label>
            <div className="dir-toggle">
              <button className="active"><MenuIconRight /></button>
              <button><MenuIconLeft /></button>
            </div>
          </div>
          <div className="sidebar-field sidebar-field--col">
            <label>Font family in the editor</label>
            <input type="text" value={editorFontFamily} onChange={e => setEditorFontFamily(e.target.value)} className="font-mono" />
          </div>
          <label className="sidebar-toggle">
            <span>Disable the browser's Ctrl-S shortcut</span>
            <div className="checkbox checked"><Check size={12} /></div>
          </label>
          <label className="sidebar-toggle sidebar-toggle--stack">
            <div>
              <span>Enable Vim Mode</span>
              <span className="toggle-hint">Applies keybindings as known from Vim.</span>
            </div>
            <div className={`checkbox ${vimMode ? 'checked' : ''}`} onClick={() => setVimMode(v => !v)}>
              {vimMode && <Check size={12} />}
            </div>
          </label>
          <div className="sidebar-delete">
            <button>Delete project</button>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="ide">
      {/* Top Navigation */}
      <div className="top-nav">
        <div className="top-nav-left">
          <div className="top-nav-back">
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
          <span className="top-nav-current">main.typ</span>
        </div>
        <div />
      </div>

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
            <button className="activity-btn"><HelpCircle size={20} /></button>
            <div className="activity-brand">typst</div>
          </div>
        </div>

        {/* Sidebar Panel */}
        {activeSidebar && <div className="sidebar">{sidebarContent}</div>}

        {/* Editor Pane */}
        <div className="editor-pane">
          <div className="editor-toolbar">
            {[Type, Bold, Italic, Underline, Heading, List, ListOrdered, Sigma, Code, AtSign, MessageSquare].map(
              (Icon, i) => (
                <button key={i} className="editor-toolbar-btn"><Icon size={16} /></button>
              )
            )}
          </div>
          <div className="editor-body">
            <div className={`editor-cm-wrap`} ref={editorRef} />
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
              <button className="preview-share">Share</button>
              <button className="preview-toolbar-btn"><MoreHorizontal size={16} /></button>
            </div>
          </div>
          <div className="preview-body">
            {error && <pre className="preview-error">{error}</pre>}
            <div
              className="preview-paper"
              style={{ transform: `scale(${zoom})` }}
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
  );
}

export default App;
