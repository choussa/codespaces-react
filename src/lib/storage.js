import { supabase, isSupabaseReady } from './supabase';

const STORAGE_KEY_PROJECTS = 'typst-projects';
const STORAGE_KEY_ACTIVE = 'typst-active-project';

export function getLocalProjects() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY_PROJECTS)) || {}; } catch { return {}; }
}

function setLocalProjects(projects) {
  localStorage.setItem(STORAGE_KEY_PROJECTS, JSON.stringify(projects));
}

export function getLocalActiveProject() {
  try { return localStorage.getItem(STORAGE_KEY_ACTIVE); } catch { return null; }
}

export function setLocalActiveProject(name) {
  localStorage.setItem(STORAGE_KEY_ACTIVE, name);
}

export function removeLocalActiveProject() {
  localStorage.removeItem(STORAGE_KEY_ACTIVE);
}

// ─── Supabase sync ──────────────────────────────────────────

async function getUserId() {
  const { data } = await supabase.auth.getSession();
  return data?.session?.user?.id;
}

async function ensureProjectRow(projectName, projectData) {
  const { data: existing } = await supabase
    .from('projects')
    .select('id')
    .eq('name', projectName)
    .maybeSingle();

  if (existing) return existing.id;

  const userId = await getUserId();
  if (!userId) return null;

  const { data } = await supabase
    .from('projects')
    .insert({
      user_id: userId,
      name: projectName,
      location: projectData?.location || 'black',
      current_file: projectData?.currentFile || 'main.typ',
      settings: projectData?.settings || {},
    })
    .select('id')
    .single();

  return data?.id;
}

export async function syncProjectsToSupabase(projects) {
  if (!isSupabaseReady()) return;
  try {
    const userId = await getUserId();
    if (!userId) return;

    for (const [name, p] of Object.entries(projects)) {
      const projectId = await ensureProjectRow(name, p);
      if (!projectId) continue;

      await supabase.from('projects').update({
        location: p.location,
        current_file: p.currentFile,
        settings: p.settings,
        updated_at: new Date().toISOString(),
      }).eq('id', projectId);

      for (const [fileName, content] of Object.entries(p.files || {})) {
        await supabase.from('project_files').upsert({
          project_id: projectId,
          name: fileName,
          content,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'project_id, name' });
      }
    }
  } catch (e) {
    console.warn('Supabase sync failed:', e.message);
  }
}

export async function syncFileToSupabase(projectName, fileName, content) {
  if (!isSupabaseReady()) return;
  try {
    const projectId = await ensureProjectRow(projectName);
    if (!projectId) return;
    await supabase.from('project_files').upsert({
      project_id: projectId,
      name: fileName,
      content,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'project_id, name' });
    await supabase.from('projects').update({
      updated_at: new Date().toISOString(),
    }).eq('id', projectId);
  } catch (e) {
    console.warn('Supabase file sync failed:', e.message);
  }
}

export async function syncFileAddToSupabase(projectName, fileName) {
  if (!isSupabaseReady()) return;
  try {
    const projectId = await ensureProjectRow(projectName);
    if (!projectId) return;
    await supabase.from('project_files').insert({
      project_id: projectId,
      name: fileName,
      content: '',
    });
    await supabase.from('projects').update({
      current_file: fileName,
      updated_at: new Date().toISOString(),
    }).eq('id', projectId);
  } catch (e) {
    console.warn('Supabase file add sync failed:', e.message);
  }
}

export async function syncFileDeleteToSupabase(projectName, fileName) {
  if (!isSupabaseReady()) return;
  try {
    const { data: project } = await supabase
      .from('projects').select('id').eq('name', projectName).maybeSingle();
    if (!project) return;
    await supabase.from('project_files').delete()
      .eq('project_id', project.id).eq('name', fileName);
    await supabase.from('projects').update({
      updated_at: new Date().toISOString(),
    }).eq('id', project.id);
  } catch (e) {
    console.warn('Supabase file delete sync failed:', e.message);
  }
}

export async function syncFileRenameToSupabase(projectName, oldName, newName) {
  if (!isSupabaseReady()) return;
  try {
    const { data: project } = await supabase
      .from('projects').select('id').eq('name', projectName).maybeSingle();
    if (!project) return;
    const { data: file } = await supabase
      .from('project_files').select('id, content')
      .eq('project_id', project.id).eq('name', oldName).maybeSingle();
    if (!file) return;
    await supabase.from('project_files').delete().eq('id', file.id);
    await supabase.from('project_files').insert({
      project_id: project.id, name: newName, content: file.content,
    });
    await supabase.from('projects').update({
      updated_at: new Date().toISOString(),
    }).eq('id', project.id);
  } catch (e) {
    console.warn('Supabase file rename sync failed:', e.message);
  }
}

export async function syncProjectDeleteToSupabase(projectName) {
  if (!isSupabaseReady()) return;
  try {
    await supabase.from('projects').delete().eq('name', projectName);
  } catch (e) {
    console.warn('Supabase project delete sync failed:', e.message);
  }
}

export async function loadProjectsFromSupabase() {
  if (!isSupabaseReady()) return null;
  try {
    const userId = await getUserId();
    if (!userId) return null;

    const { data: projects } = await supabase
      .from('projects').select('*').eq('user_id', userId);
    if (!projects || projects.length === 0) return null;

    const result = {};
    for (const p of projects) {
      const { data: files } = await supabase
        .from('project_files').select('name, content').eq('project_id', p.id);
      const fileMap = {};
      for (const f of files || []) fileMap[f.name] = f.content;
      result[p.name] = {
        id: p.id,
        name: p.name,
        location: p.location,
        currentFile: p.current_file,
        modified: new Date(p.updated_at).toLocaleDateString(),
        settings: p.settings,
        files: fileMap,
      };
    }
    return result;
  } catch (e) {
    console.warn('Supabase load failed:', e.message);
    return null;
  }
}
