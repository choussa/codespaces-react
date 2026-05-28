import { useState, useRef, useEffect } from 'react';
import { Download, FileImage, FileType, FileJson, Archive } from 'lucide-react';

const ITEMS = [
  { id: 'pdf', label: 'Export PDF', icon: FileType, desc: 'Document as PDF' },
  { id: 'png', label: 'Export PNG', icon: FileImage, desc: 'First page as image' },
  { id: 'svg', label: 'Export SVG', icon: FileJson, desc: 'Document as SVG' },
  { id: 'zip', label: 'Export ZIP', icon: Archive, desc: 'All project files' },
];

export default function DownloadDropdown({ onExport, disabled }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div className="download-dropdown" ref={ref}>
      <button
        className="download-dropdown-trigger"
        onClick={() => setOpen(!open)}
        disabled={disabled}
        title="Download"
        type="button"
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="Open export menu"
      >
        <Download size={16} />
      </button>
      {open && (
        <div className="download-dropdown-menu" role="menu" aria-label="Export options">
          {ITEMS.map(item => (
            <button
              key={item.id}
              className="download-dropdown-item"
              type="button"
              role="menuitem"
              onClick={() => {
                onExport(item.id);
                setOpen(false);
              }}
            >
              <item.icon size={16} />
              <div className="download-dropdown-item-text">
                <span>{item.label}</span>
                <span className="download-dropdown-item-desc">{item.desc}</span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
