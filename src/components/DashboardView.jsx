import { useMemo, useState } from 'react';
import {
  Plus, Folder, Grid3x3, List, ChevronDown, Share2, Download,
  GitBranch, Clock, SortDesc, Trash2, Search, ArrowUpDown, LogOut,
  ChevronRight, ChevronLeft, Settings
} from 'lucide-react';

const DEFAULT_COLORS = ['#1e3a5f', '#3b1f4e', '#1f4a3a', '#4a2c1a', '#2a2a3a', '#3a1a2a'];

function ProjectCard({ project, onClick, onDelete, palette, onDragStart, onDragEnd }) {
  const colors = palette?.length ? palette : DEFAULT_COLORS;
  const colorIdx = project.name.split('').reduce((a, c) => a + c.charCodeAt(0), 0) % colors.length;
  const accentColor = project.settings?.accentColor || colors[colorIdx];
  return (
    <div
      className="dashboard-card"
      draggable
      onDragStart={(event) => onDragStart?.(event, project.name)}
      onDragEnd={onDragEnd}
    >
      <div className="dashboard-card-thumb" style={{ background: accentColor }} onClick={() => onClick(project.name)}>
        <span className="dashboard-card-tag">{project.location || 'personal'}</span>
        <div className="dashboard-card-preview">
          <Folder size={32} opacity={0.35} />
        </div>
        <button
          className="dashboard-card-delete"
          onClick={e => { e.stopPropagation(); onDelete(project.name); }}
          title="Delete project"
          type="button"
          aria-label={`Delete project ${project.name}`}
        >
          <Trash2 size={14} />
        </button>
      </div>
      <div className="dashboard-card-info" onClick={() => onClick(project.name)}>
        <span className="dashboard-card-name">{project.name}</span>
        <span className="dashboard-card-date">
          <Clock size={12} />
          {project.modified || 'Just now'}
        </span>
      </div>
    </div>
  );
}

function ProjectListRow({ project, onClick, onDelete, palette, onDragStart, onDragEnd }) {
  const colors = palette?.length ? palette : DEFAULT_COLORS;
  const colorIdx = project.name.split('').reduce((a, c) => a + c.charCodeAt(0), 0) % colors.length;
  const accentColor = project.settings?.accentColor || colors[colorIdx];
  return (
    <div
      className="dashboard-list-row"
      onClick={() => onClick(project.name)}
      draggable
      onDragStart={(event) => onDragStart?.(event, project.name)}
      onDragEnd={onDragEnd}
    >
      <div className="dashboard-list-preview" style={{ background: accentColor }}>
        <Folder size={18} opacity={0.45} />
      </div>
      <div className="dashboard-list-main">
        <span className="dashboard-list-name">{project.name}</span>
        <span className="dashboard-list-meta">
          <span className="dashboard-list-pill">{project.location || 'personal'}</span>
          <span className="dashboard-list-date">
            <Clock size={12} />
            {project.modified || 'Just now'}
          </span>
        </span>
      </div>
      <button
        className="dashboard-list-delete"
        onClick={e => { e.stopPropagation(); onDelete(project.name); }}
        title="Delete project"
        type="button"
        aria-label={`Delete project ${project.name}`}
      >
        <Trash2 size={14} />
      </button>
    </div>
  );
}

function FolderCard({ folder, onOpen, onDropProject, onDragEnter, onDragLeave, isDragOver }) {
  const accentColor = folder.color || DEFAULT_COLORS[0];
  return (
    <div
      className={`dashboard-card dashboard-folder-card${isDragOver ? ' drag-over' : ''}`}
      onClick={() => onOpen(folder.path)}
      onDragEnter={() => onDragEnter?.(folder.path)}
      onDragLeave={onDragLeave}
      onDragOver={(event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
      }}
      onDrop={(event) => {
        event.preventDefault();
        const name = event.dataTransfer.getData('text/plain');
        if (name) onDropProject?.(name, folder.path);
      }}
    >
      <div className="dashboard-card-thumb" style={{ background: accentColor }}>
        <span className="dashboard-card-tag">folder</span>
        <div className="dashboard-card-preview">
          <Folder size={32} opacity={0.45} />
        </div>
      </div>
      <div className="dashboard-card-info">
        <span className="dashboard-card-name">{folder.name}</span>
        <span className="dashboard-card-date">
          <Clock size={12} />
          {folder.updatedAt ? new Date(folder.updatedAt).toLocaleDateString() : 'New folder'}
        </span>
      </div>
    </div>
  );
}

function FolderListRow({ folder, onOpen, onDropProject, onDragEnter, onDragLeave, isDragOver }) {
  const accentColor = folder.color || DEFAULT_COLORS[0];
  return (
    <div
      className={`dashboard-list-row dashboard-folder-row${isDragOver ? ' drag-over' : ''}`}
      onClick={() => onOpen(folder.path)}
      onDragEnter={() => onDragEnter?.(folder.path)}
      onDragLeave={onDragLeave}
      onDragOver={(event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
      }}
      onDrop={(event) => {
        event.preventDefault();
        const name = event.dataTransfer.getData('text/plain');
        if (name) onDropProject?.(name, folder.path);
      }}
    >
      <div className="dashboard-list-preview" style={{ background: accentColor }}>
        <Folder size={18} opacity={0.55} />
      </div>
      <div className="dashboard-list-main">
        <span className="dashboard-list-name">{folder.name}</span>
        <span className="dashboard-list-meta">
          <span className="dashboard-list-pill">folder</span>
          <span className="dashboard-list-date">
            <Clock size={12} />
            {folder.updatedAt ? new Date(folder.updatedAt).toLocaleDateString() : 'New folder'}
          </span>
        </span>
      </div>
    </div>
  );
}

export default function DashboardView({
  projects,
  folders,
  currentFolderPath,
  onOpenProject,
  onCreateProject,
  onCreateFolder,
  onOpenFolder,
  onMoveProjectToFolder,
  onGoToParent,
  onDeleteProject,
  onStartFromGitLab,
  sessionEmail,
  onLogout,
  colorOptions,
  selectedColor,
  onSelectColor,
}) {
  const [viewMode, setViewMode] = useState('grid');
  const [sortBy, setSortBy] = useState('modified');
  const [sortDir, setSortDir] = useState('desc');
  const [searchQuery, setSearchQuery] = useState('');
  const [dragOverFolder, setDragOverFolder] = useState('');
  const [dragOverArea, setDragOverArea] = useState(false);

  const palette = colorOptions?.length ? colorOptions : DEFAULT_COLORS;
  const projectList = Array.isArray(projects) ? projects : Object.values(projects || {});
  const folderList = Array.isArray(folders) ? folders : Object.values(folders || {});
  const normalizedFolderPath = currentFolderPath || '';
  const breadcrumbParts = useMemo(() => {
    const parts = normalizedFolderPath.split('/').filter(Boolean);
    const crumbs = [{ label: 'All projects', path: '' }];
    parts.forEach((part, index) => {
      crumbs.push({
        label: part,
        path: parts.slice(0, index + 1).join('/'),
      });
    });
    return crumbs;
  }, [normalizedFolderPath]);

  const handleCreateProject = () => {
    setSearchQuery('');
    onCreateProject();
  };

  const handleCreateFolder = () => {
    setSearchQuery('');
    onCreateFolder?.();
  };

  const handleProjectDragStart = (event, name) => {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', name);
  };

  const handleProjectDragEnd = () => {
    setDragOverFolder('');
    setDragOverArea(false);
  };

  const handleDropToCurrentFolder = (event) => {
    event.preventDefault();
    const name = event.dataTransfer.getData('text/plain');
    if (!name) return;
    onMoveProjectToFolder?.(name, normalizedFolderPath);
    setDragOverArea(false);
  };

  const handleDragLeaveArea = (event) => {
    if (event.currentTarget.contains(event.relatedTarget)) return;
    setDragOverArea(false);
  };

  const loweredQuery = searchQuery.trim().toLowerCase();
  const filteredFolders = folderList.filter(folder =>
    !loweredQuery || folder.name.toLowerCase().includes(loweredQuery)
  );
  const filteredProjects = projectList.filter(project =>
    !loweredQuery || project.name.toLowerCase().includes(loweredQuery)
  );

  const sortedFolders = [...filteredFolders].sort((a, b) => a.name.localeCompare(b.name));

  const sortedProjects = [...filteredProjects].sort((a, b) => {
    let cmp = 0;
    if (sortBy === 'name') {
      cmp = a.name.localeCompare(b.name);
    } else if (sortBy === 'created') {
      cmp = (a.created || '').localeCompare(b.created || '');
    } else {
      cmp = (b.modified || '').localeCompare(a.modified || '');
    }
    return sortDir === 'desc' ? cmp : -cmp;
  });

  return (
    <div className="dashboard">
      {/* Dashboard Top Nav */}
      <div className="dashboard-topnav">
        <div className="dashboard-topnav-left">
          <div className="dashboard-brand">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="4 7 4 4 20 4 20 7" />
              <line x1="9" y1="20" x2="15" y2="20" />
              <line x1="12" y1="4" x2="12" y2="20" />
            </svg>
            <span>Typst</span>
          </div>
          <div className="dashboard-topnav-links">
            <span className="active">Project</span>
            <span>Team</span>
            <span>View</span>
            <span>Help</span>
          </div>
        </div>
        <div className="dashboard-topnav-right">
          {sessionEmail && (
            <div className="dashboard-user-menu">
              <div className="dashboard-avatar" title={sessionEmail}>
                {sessionEmail[0].toUpperCase()}
              </div>
              <button className="dashboard-topnav-btn" onClick={onLogout} title="Sign out" type="button" aria-label="Sign out">
                <LogOut size={14} />
              </button>
            </div>
          )}
          <button className="dashboard-topnav-btn" title="Share" type="button" aria-label="Share">
            <Share2 size={16} />
          </button>
          <button className="dashboard-topnav-btn" title="Downloads" type="button" aria-label="Downloads">
            <Download size={16} />
          </button>
        </div>
      </div>

      {/* Dashboard Content */}
      <div className="dashboard-content">
        <div className="dashboard-title-row">
          <h1 className="dashboard-title">Dashboard</h1>
          <div className="dashboard-breadcrumbs">
            {breadcrumbParts.map((crumb, index) => (
              <button
                key={crumb.path || 'root'}
                className={`dashboard-crumb${index === breadcrumbParts.length - 1 ? ' active' : ''}`}
                type="button"
                onClick={() => onOpenFolder?.(crumb.path)}
              >
                <span>{crumb.label}</span>
                {index < breadcrumbParts.length - 1 && <ChevronRight size={12} />}
              </button>
            ))}
          </div>
        </div>

        <div className="dashboard-folder-actions">
          <button
            className="dashboard-btn dashboard-btn--ghost"
            type="button"
            onClick={onGoToParent}
            disabled={!normalizedFolderPath}
          >
            <ChevronLeft size={14} /> Go to parent
          </button>
          <button className="dashboard-btn dashboard-btn--ghost" type="button" aria-label="Folder settings">
            <Settings size={14} /> Folder settings
          </button>
        </div>

        {/* Quick Actions */}
        <div className="dashboard-quick-actions">
          <button className="dashboard-quick-card" type="button" onClick={handleCreateProject}>
            <div className="quick-card-icon">
              <Plus size={24} />
            </div>
            <div className="quick-card-text">
              <strong>Start from scratch</strong>
              <span>Empty document</span>
            </div>
          </button>
          <button className="dashboard-quick-card" type="button" onClick={onStartFromGitLab} aria-label="Start from GitLab (coming soon)">
            <div className="quick-card-icon">
              <GitBranch size={24} />
            </div>
            <div className="quick-card-text">
              <strong>Start from GitLab</strong>
              <span>Clone a repository</span>
            </div>
          </button>
        </div>

        {/* Toolbar */}
        <div className="dashboard-toolbar">
          <div className="dashboard-toolbar-left">
            <button className="dashboard-btn" onClick={handleCreateFolder} type="button">
              <Plus size={16} /> New folder
            </button>
            <div className="dashboard-color-picker" role="group" aria-label="Project color">
              <span className="dashboard-color-label">Color</span>
              <div className="dashboard-color-swatches">
                {palette.map((color, index) => (
                  <button
                    key={color}
                    className={`dashboard-color-swatch${selectedColor === color ? ' active' : ''}`}
                    style={{ background: color }}
                    type="button"
                    aria-label={`Select project color ${index + 1}`}
                    aria-pressed={selectedColor === color}
                    onClick={() => onSelectColor?.(color)}
                  />
                ))}
              </div>
            </div>
          </div>
          <div className="dashboard-toolbar-right">
            <div className="dashboard-search">
              <Search size={14} className="dashboard-search-icon" />
              <input
                type="text"
                placeholder="Search projects..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="dashboard-search-input"
              />
            </div>
            <div className="dashboard-view-toggle">
                <button
                  className={`view-toggle-btn ${viewMode === 'grid' ? 'active' : ''}`}
                  onClick={() => setViewMode('grid')}
                  type="button"
                  aria-label="Grid view"
                  aria-pressed={viewMode === 'grid'}
                >
                <Grid3x3 size={16} />
              </button>
                <button
                  className={`view-toggle-btn ${viewMode === 'list' ? 'active' : ''}`}
                  onClick={() => setViewMode('list')}
                  type="button"
                  aria-label="List view"
                  aria-pressed={viewMode === 'list'}
                >
                <List size={16} />
              </button>
            </div>
            <div className="dashboard-sort">
              <SortDesc size={14} />
              <select value={sortBy} onChange={e => setSortBy(e.target.value)}>
                <option value="modified">last modified</option>
                <option value="name">name</option>
                <option value="created">created</option>
              </select>
              <button className="dashboard-sort-dir" onClick={() => setSortDir(d => d === 'desc' ? 'asc' : 'desc')} title="Toggle sort direction" type="button" aria-label="Toggle sort direction">
                <ArrowUpDown size={14} />
              </button>
              <ChevronDown size={14} className="sort-chevron" />
            </div>
          </div>
        </div>

        {/* Project Grid */}
        {sortedFolders.length === 0 && sortedProjects.length === 0 && !loweredQuery ? (
          <div className="dashboard-empty">
            <Folder size={48} />
            <h3>{normalizedFolderPath ? 'This folder is empty' : 'No projects yet'}</h3>
            <p>{normalizedFolderPath ? 'Drop a project here or create a new one.' : 'Create your first project to get started.'}</p>
            <button className="dashboard-btn dashboard-btn--primary" onClick={handleCreateProject} type="button">
              <Plus size={16} /> Create project
            </button>
          </div>
        ) : sortedFolders.length === 0 && sortedProjects.length === 0 ? (
          <div className="dashboard-empty">
            <Search size={48} />
            <h3>No matching items</h3>
            <p>Try a different search term.</p>
          </div>
        ) : viewMode === 'list' ? (
          <div
            className={`dashboard-list${dragOverArea ? ' drag-over' : ''}`}
            onDragOver={(event) => {
              event.preventDefault();
              setDragOverArea(true);
            }}
            onDragLeave={handleDragLeaveArea}
            onDrop={handleDropToCurrentFolder}
          >
            {sortedFolders.map(folder => (
              <FolderListRow
                key={folder.path}
                folder={folder}
                onOpen={onOpenFolder}
                onDropProject={(name, path) => {
                  onMoveProjectToFolder?.(name, path);
                  setDragOverFolder('');
                  setDragOverArea(false);
                }}
                onDragEnter={setDragOverFolder}
                onDragLeave={() => setDragOverFolder('')}
                isDragOver={dragOverFolder === folder.path}
              />
            ))}
            {sortedProjects.map(p => (
              <ProjectListRow
                key={p.name}
                project={p}
                onClick={onOpenProject}
                onDelete={onDeleteProject}
                palette={palette}
                onDragStart={handleProjectDragStart}
                onDragEnd={handleProjectDragEnd}
              />
            ))}
          </div>
        ) : (
          <div
            className={`dashboard-grid${dragOverArea ? ' drag-over' : ''}`}
            onDragOver={(event) => {
              event.preventDefault();
              setDragOverArea(true);
            }}
            onDragLeave={handleDragLeaveArea}
            onDrop={handleDropToCurrentFolder}
          >
            {sortedFolders.map(folder => (
              <FolderCard
                key={folder.path}
                folder={folder}
                onOpen={onOpenFolder}
                onDropProject={(name, path) => {
                  onMoveProjectToFolder?.(name, path);
                  setDragOverFolder('');
                  setDragOverArea(false);
                }}
                onDragEnter={setDragOverFolder}
                onDragLeave={() => setDragOverFolder('')}
                isDragOver={dragOverFolder === folder.path}
              />
            ))}
            {sortedProjects.map(p => (
              <ProjectCard
                key={p.name}
                project={p}
                onClick={onOpenProject}
                onDelete={onDeleteProject}
                palette={palette}
                onDragStart={handleProjectDragStart}
                onDragEnd={handleProjectDragEnd}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
