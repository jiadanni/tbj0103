use tauri::State;
use crate::db::DbState;
use crate::models::note::{ProjectNote, DailyNote, NoteTemplate, CreateNoteRequest, UpdateNoteRequest, GetOrCreateDailyNoteRequest};

#[tauri::command]
pub fn create_note(state: State<DbState>, req: CreateNoteRequest) -> Result<ProjectNote, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().to_rfc3339();
    let note = ProjectNote {
        id: uuid::Uuid::new_v4().to_string(),
        project_id: req.project_id,
        title: req.title,
        content: req.content.unwrap_or_default(),
        note_type: req.note_type.unwrap_or_else(|| "manual".to_string()),
        tags: req.tags.unwrap_or_default(),
        created_at: now.clone(),
        updated_at: now,
    };
    let tags_json = serde_json::to_string(&note.tags).unwrap_or_default();
    conn.execute(
        "INSERT INTO project_notes (id, project_id, title, content, note_type, tags, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        rusqlite::params![note.id, note.project_id, note.title, note.content, note.note_type, tags_json, note.created_at, note.updated_at],
    ).map_err(|e| e.to_string())?;
    Ok(note)
}

#[tauri::command]
pub fn list_notes(state: State<DbState>, project_id: String) -> Result<Vec<ProjectNote>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare(
        "SELECT id, project_id, title, content, note_type, tags, created_at, updated_at
         FROM project_notes WHERE project_id = ?1 ORDER BY updated_at DESC"
    ).map_err(|e| e.to_string())?;
    let items = stmt.query_map(rusqlite::params![project_id], |row| {
        let tags_json: String = row.get(5)?;
        Ok(ProjectNote {
            id: row.get(0)?,
            project_id: row.get(1)?,
            title: row.get(2)?,
            content: row.get(3)?,
            note_type: row.get(4)?,
            tags: serde_json::from_str(&tags_json).unwrap_or_default(),
            created_at: row.get(6)?,
            updated_at: row.get(7)?,
        })
    }).map_err(|e| e.to_string())?
    .collect::<Result<Vec<_>, _>>()
    .map_err(|e| e.to_string())?;
    Ok(items)
}

#[tauri::command]
pub fn get_note(state: State<DbState>, id: String) -> Result<Option<ProjectNote>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let result = conn.query_row(
        "SELECT id, project_id, title, content, note_type, tags, created_at, updated_at FROM project_notes WHERE id = ?1",
        rusqlite::params![id],
        |row| {
            let tags_json: String = row.get(5)?;
            Ok(ProjectNote {
                id: row.get(0)?,
                project_id: row.get(1)?,
                title: row.get(2)?,
                content: row.get(3)?,
                note_type: row.get(4)?,
                tags: serde_json::from_str(&tags_json).unwrap_or_default(),
                created_at: row.get(6)?,
                updated_at: row.get(7)?,
            })
        },
    );
    match result {
        Ok(n) => Ok(Some(n)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub fn update_note(state: State<DbState>, req: UpdateNoteRequest) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().to_rfc3339();
    let tags_json = req.tags.as_ref().map(|t| serde_json::to_string(t).unwrap_or_default());
    conn.execute(
        "UPDATE project_notes SET title = COALESCE(?1, title), content = COALESCE(?2, content), tags = COALESCE(?3, tags), updated_at = ?4 WHERE id = ?5",
        rusqlite::params![req.title, req.content, tags_json, now, req.id],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn delete_note(state: State<DbState>, id: String) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM project_notes WHERE id = ?1", rusqlite::params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn get_or_create_daily_note(state: State<DbState>, req: GetOrCreateDailyNoteRequest) -> Result<DailyNote, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let date = req.date.unwrap_or_else(|| chrono::Utc::now().format("%Y-%m-%d").to_string());
    // Try to find existing note for this date
    let result = conn.query_row(
        "SELECT id, workspace_id, date, content, mood, productivity, template_id, created_at, updated_at FROM daily_notes WHERE workspace_id = ?1 AND date = ?2",
        rusqlite::params![req.workspace_id, date],
        |row| Ok(DailyNote {
            id: row.get(0)?,
            workspace_id: row.get(1)?,
            date: row.get(2)?,
            content: row.get(3)?,
            mood: row.get(4)?,
            productivity: row.get(5)?,
            template_id: row.get(6)?,
            created_at: row.get(7)?,
            updated_at: row.get(8)?,
        }),
    );
    match result {
        Ok(note) => Ok(note),
        Err(rusqlite::Error::QueryReturnedNoRows) => {
            let note = DailyNote::new(req.workspace_id, date);
            conn.execute(
                "INSERT INTO daily_notes (id, workspace_id, date, content, mood, productivity, template_id, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                rusqlite::params![note.id, note.workspace_id, note.date, note.content, note.mood, note.productivity, note.template_id, note.created_at, note.updated_at],
            ).map_err(|e| e.to_string())?;
            Ok(note)
        }
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub fn list_templates(state: State<DbState>, workspace_id: String) -> Result<Vec<NoteTemplate>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare(
        "SELECT id, workspace_id, name, template_description, content, icon, is_built_in, variables, created_at, updated_at
         FROM note_templates WHERE workspace_id = ?1 ORDER BY is_built_in DESC, name ASC"
    ).map_err(|e| e.to_string())?;
    let items = stmt.query_map(rusqlite::params![workspace_id], |row| {
        let vars_json: String = row.get(7)?;
        Ok(NoteTemplate {
            id: row.get(0)?,
            workspace_id: row.get(1)?,
            name: row.get(2)?,
            template_description: row.get(3)?,
            content: row.get(4)?,
            icon: row.get(5)?,
            is_built_in: row.get::<_, i32>(6)? != 0,
            variables: serde_json::from_str(&vars_json).unwrap_or_default(),
            created_at: row.get(8)?,
            updated_at: row.get(9)?,
        })
    }).map_err(|e| e.to_string())?
    .collect::<Result<Vec<_>, _>>()
    .map_err(|e| e.to_string())?;
    Ok(items)
}

#[tauri::command]
pub fn create_template(state: State<DbState>, workspace_id: String, name: String, content: String, icon: Option<String>) -> Result<NoteTemplate, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().to_rfc3339();
    let t = NoteTemplate {
        id: uuid::Uuid::new_v4().to_string(),
        workspace_id,
        name,
        template_description: String::new(),
        content,
        icon: icon.unwrap_or_else(|| "doc".to_string()),
        is_built_in: false,
        variables: vec![],
        created_at: now.clone(),
        updated_at: now,
    };
    let vars_json = "[]".to_string();
    conn.execute(
        "INSERT INTO note_templates (id, workspace_id, name, template_description, content, icon, is_built_in, variables, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        rusqlite::params![t.id, t.workspace_id, t.name, t.template_description, t.content, t.icon, t.is_built_in as i32, vars_json, t.created_at, t.updated_at],
    ).map_err(|e| e.to_string())?;
    Ok(t)
}
