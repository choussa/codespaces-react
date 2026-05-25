import { useState } from 'react';
import {
  Plus, Folder, Grid3x3, List, ChevronDown, Share2, Download,
  GitBranch, FileText, Clock, SortDesc
} from 'lucide-react';

const THUMBNAIL_COLORS = ['#1e3a5f', '#3b1f4e', '#1f4a3a', '#4a2c1a', '#2a2a3a', '#3a1a2a'];

function ProjectCard({ project, onClick, onDelete }) {
  const colorIdx = project.name.split('').reduce((a, c) => a + c.charCodeAt(0), 0) % THUMBNAIL_COLORS.length;
  return (
    <div className="dashboard-card" onClick={() => onClick(project.name)}>
      <div className="dashboard-card-thumb" style={{ background: THUMBNAIL_COLORS[colorIdx] }}>
        <span className="dashboard-card-tag">{project.location || 'personal'}</span>
        <div className="dashboard-card-preview">
          <FileText size={32} opacity={0.3} />
        </div>
      </div>
      <div className="dashboard-card-info">
        <span className="dashboard-card-name">{project.name}</span>
        <span className="dashboard-card-date">
          <Clock size={12} />
          {project.modified || 'Just now'}
        </span>
      </div>
    </div>
  );
}

export default function DashboardView({ projects, onOpenProject, onCreateProject, onDeleteProject }) {
  const [viewMode, setViewMode] = useState('grid');
  const [sortBy, setSortBy] = useState('modified');

  const sorted = Object.values(projects).sort((a, b) => {
    if (sortBy === 'name') return a.name.localeCompare(b.name);
    return (b.modified || '').localeCompare(a.modified || '');
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
          <button className="dashboard-topnav-btn" title="Share">
            <Share2 size={16} />
          </button>
          <button className="dashboard-topnav-btn" title="Downloads">
            <Download size={16} />
          </button>
          <div className="dashboard-avatar" title="User">
            <span>b</span>
          </div>
        </div>
      </div>

      {/* Dashboard Content */}
      <div className="dashboard-content">
        <h1 className="dashboard-title">Dashboard</h1>

        {/* Quick Actions */}
        <div className="dashboard-quick-actions">
          <div className="dashboard-quick-card" onClick={() => onCreateProject()}>
            <div className="quick-card-icon">
              <Plus size={24} />
            </div>
            <div className="quick-card-text">
              <strong>Start from scratch</strong>
              <span>Empty document</span>
            </div>
          </div>
          <div className="dashboard-quick-card">
            <div className="quick-card-icon">
              <GitBranch size={24} />
            </div>
            <div className="quick-card-text">
              <strong>Start from GitLab</strong>
              <span>Clone a repository</span>
            </div>
          </div>
        </div>

        {/* Toolbar */}
        <div className="dashboard-toolbar">
          <div className="dashboard-toolbar-left">
            <button className="dashboard-btn" onClick={() => onCreateProject()}>
              <Plus size={16} /> New folder
            </button>
          </div>
          <div className="dashboard-toolbar-right">
            <div className="dashboard-view-toggle">
              <button
                className={`view-toggle-btn ${viewMode === 'grid' ? 'active' : ''}`}
                onClick={() => setViewMode('grid')}
              >
                <Grid3x3 size={16} />
              </button>
              <button
                className={`view-toggle-btn ${viewMode === 'list' ? 'active' : ''}`}
                onClick={() => setViewMode('list')}
              >
                <List size={16} />
              </button>
            </div>
            <div className="dashboard-sort">
              <SortDesc size={14} />
              <select value={sortBy} onChange={e => setSortBy(e.target.value)}>
                <option value="modified">last modified</option>
                <option value="name">name</option>
              </select>
              <ChevronDown size={14} className="sort-chevron" />
            </div>
          </div>
        </div>

        {/* Project Grid */}
        {Object.keys(projects).length === 0 ? (
          <div className="dashboard-empty">
            <Folder size={48} />
            <h3>No projects yet</h3>
            <p>Create your first project to get started.</p>
            <button className="dashboard-btn dashboard-btn--primary" onClick={() => onCreateProject()}>
              <Plus size={16} /> Create project
            </button>
          </div>
        ) : (
          <div className={`dashboard-grid ${viewMode === 'list' ? 'dashboard-list' : ''}`}>
            {sorted.map(p => (
              <ProjectCard
                key={p.name}
                project={p}
                onClick={onOpenProject}
                onDelete={onDeleteProject}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
