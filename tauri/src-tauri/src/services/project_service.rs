use crate::models::project::{CreateProjectRequest, Project, UpdateProjectRequest};
use crate::services::chat_file_store;
use crate::services::workspace_hierarchy::workspace_filter_sql;
use rusqlite::Connection;
use std::path::Path;

fn row_to_project(row: &rusqlite::Row<'_>) -> rusqlite::Result<Project> {
    Ok(Project {
        id: row.get(0)?,
        workspace_id: row.get(1)?,
        name: row.get(2)?,
        project_description: row.get(3)?,
        custom_instructions: row.get(4)?,
        color: row.get(5)?,
        icon: row.get(6)?,
        created_at: row.get(7)?,
        updated_at: row.get(8)?,
    })
}

pub fn create(conn: &Connection, req: CreateProjectRequest) -> Result<Project, String> {
    let mut project = Project::new(req.workspace_id.clone(), req.name);
    if let Some(description) = req.project_description {
        project.project_description = description;
    }
    if let Some(instructions) = req.custom_instructions {
        project.custom_instructions = instructions;
    }
    if let Some(color) = req.color {
        project.color = color;
    }
    if let Some(icon) = req.icon {
        project.icon = icon;
    }

    conn.execute(
        "INSERT INTO projects (id, workspace_id, name, project_description, custom_instructions, color, icon, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        rusqlite::params![
            project.id,
            project.workspace_id,
            project.name,
            project.project_description,
            project.custom_instructions,
            project.color,
            project.icon,
            project.created_at,
            project.updated_at
        ],
    )
    .map_err(|e| e.to_string())?;

    Ok(project)
}

pub fn list(conn: &Connection, workspace_id: &str, include_descendants: bool) -> Result<Vec<Project>, String> {
    let (cte, ws_cond) = workspace_filter_sql(include_descendants);
    let sql = format!(
        "{cte}SELECT id, workspace_id, name, project_description, custom_instructions, color, icon, created_at, updated_at
         FROM projects WHERE workspace_id {ws_cond} ORDER BY created_at DESC"
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(rusqlite::params![workspace_id], row_to_project)
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

pub fn get(conn: &Connection, id: &str) -> Result<Option<Project>, String> {
    let result = conn.query_row(
        "SELECT id, workspace_id, name, project_description, custom_instructions, color, icon, created_at, updated_at
         FROM projects WHERE id = ?1",
        rusqlite::params![id],
        row_to_project,
    );
    match result {
        Ok(project) => Ok(Some(project)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

pub fn update(
    conn: &Connection,
    req: UpdateProjectRequest,
    chats_dir: &Path,
    passphrase: Option<&str>,
) -> Result<(), String> {
    let session_ids = if req.name.is_some() {
        let mut stmt = conn
            .prepare("SELECT id FROM chat_sessions WHERE project_id = ?1")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(rusqlite::params![req.id.clone()], |row| row.get::<_, String>(0))
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?
    } else {
        Vec::new()
    };
    let previous_paths =
        chat_file_store::capture_session_file_variants(conn, chats_dir, &session_ids);
    let now = chrono::Utc::now().to_rfc3339();

    conn.execute(
        "UPDATE projects SET
            name = COALESCE(?1, name),
            project_description = COALESCE(?2, project_description),
            custom_instructions = COALESCE(?3, custom_instructions),
            color = COALESCE(?4, color),
            icon = COALESCE(?5, icon),
            updated_at = ?6
         WHERE id = ?7",
        rusqlite::params![
            req.name,
            req.project_description,
            req.custom_instructions,
            req.color,
            req.icon,
            now,
            req.id
        ],
    )
    .map_err(|e| e.to_string())?;

    if !session_ids.is_empty() {
        chat_file_store::sync_session_files_for_hierarchy_change(
            conn,
            chats_dir,
            &session_ids,
            &previous_paths,
            passphrase,
        )?;
    }

    Ok(())
}

pub fn delete(conn: &Connection, id: &str) -> Result<(), String> {
    conn.execute("DELETE FROM projects WHERE id = ?1", rusqlite::params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn move_to_workspace(
    conn: &mut Connection,
    project_id: &str,
    target_workspace_id: &str,
    chats_dir: &Path,
    passphrase: Option<&str>,
) -> Result<Project, String> {
    let mut session_id_stmt = conn
        .prepare("SELECT id FROM chat_sessions WHERE project_id = ?1")
        .map_err(|e| e.to_string())?;
    let session_ids = session_id_stmt
        .query_map(rusqlite::params![project_id], |row| row.get::<_, String>(0))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    drop(session_id_stmt);

    let previous_paths =
        chat_file_store::capture_session_file_variants(conn, chats_dir, &session_ids);

    let source_project: Project = conn
        .query_row(
            "SELECT id, workspace_id, name, project_description, custom_instructions, color, icon, created_at, updated_at
             FROM projects WHERE id = ?1",
            rusqlite::params![project_id],
            row_to_project,
        )
        .map_err(|e| e.to_string())?;

    if source_project.workspace_id == target_workspace_id {
        return Ok(source_project);
    }

    let now = chrono::Utc::now().to_rfc3339();
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let new_project = Project::new(target_workspace_id.to_string(), source_project.name.clone());

    tx.execute(
        "INSERT INTO projects (id, workspace_id, name, project_description, custom_instructions, color, icon, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        rusqlite::params![
            new_project.id,
            new_project.workspace_id,
            new_project.name,
            source_project.project_description,
            source_project.custom_instructions,
            source_project.color,
            source_project.icon,
            new_project.created_at,
            new_project.updated_at
        ],
    )
    .map_err(|e| e.to_string())?;

    tx.execute(
        "UPDATE chat_sessions
         SET workspace_id = ?1, project_id = ?2, updated_at = ?3
         WHERE project_id = ?4",
        rusqlite::params![target_workspace_id, new_project.id, now, project_id],
    )
    .map_err(|e| e.to_string())?;

    tx.execute(
        "DELETE FROM projects WHERE id = ?1",
        rusqlite::params![project_id],
    )
    .map_err(|e| e.to_string())?;

    tx.commit().map_err(|e| e.to_string())?;

    if !session_ids.is_empty() {
        chat_file_store::sync_session_files_for_hierarchy_change(
            conn,
            chats_dir,
            &session_ids,
            &previous_paths,
            passphrase,
        )?;
    }

    Ok(Project {
        id: new_project.id,
        workspace_id: new_project.workspace_id,
        name: new_project.name,
        project_description: source_project.project_description,
        custom_instructions: source_project.custom_instructions,
        color: source_project.color,
        icon: source_project.icon,
        created_at: new_project.created_at,
        updated_at: new_project.updated_at,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::test_utils::tests::setup_test_db;
    use crate::services::workspace_service;
    use crate::models::workspace::CreateWorkspaceRequest;

    fn setup_workspace(conn: &Connection, name: &str) -> String {
        let ws = workspace_service::create(conn, CreateWorkspaceRequest {
            name: name.to_string(),
            description: None,
        }).unwrap();
        ws.id
    }

    #[test]
    fn test_create_and_get_project() {
        let pool = setup_test_db();
        let conn = pool.get().unwrap();
        let ws_id = setup_workspace(&conn, "Test Workspace");
        
        let req = CreateProjectRequest {
            workspace_id: ws_id.clone(),
            name: "Test Project".to_string(),
            project_description: Some("Desc".to_string()),
            custom_instructions: None,
            color: None,
            icon: None,
        };
        
        let created = create(&conn, req).unwrap();
        assert_eq!(created.name, "Test Project");
        assert_eq!(created.project_description, "Desc");
        
        let fetched = get(&conn, &created.id).unwrap().unwrap();
        assert_eq!(fetched.id, created.id);
        assert_eq!(fetched.workspace_id, ws_id);
    }

    #[test]
    fn test_list_and_delete_projects() {
        let pool = setup_test_db();
        let conn = pool.get().unwrap();
        let ws_id = setup_workspace(&conn, "Test Workspace");
        
        create(&conn, CreateProjectRequest {
            workspace_id: ws_id.clone(),
            name: "Project A".to_string(),
            project_description: None,
            custom_instructions: None,
            color: None,
            icon: None,
        }).unwrap();
        
        let p_b = create(&conn, CreateProjectRequest {
            workspace_id: ws_id.clone(),
            name: "Project B".to_string(),
            project_description: None,
            custom_instructions: None,
            color: None,
            icon: None,
        }).unwrap();
        
        let all = list(&conn, &ws_id, false).unwrap();
        assert_eq!(all.len(), 2);
        
        delete(&conn, &p_b.id).unwrap();
        let after_delete = list(&conn, &ws_id, false).unwrap();
        assert_eq!(after_delete.len(), 1);
        assert_eq!(after_delete[0].name, "Project A");
    }

    #[test]
    fn test_move_to_workspace() {
        let pool = setup_test_db();
        let mut conn = pool.get().unwrap();
        let ws1_id = setup_workspace(&conn, "WS 1");
        let ws2_id = setup_workspace(&conn, "WS 2");
        
        let p = create(&conn, CreateProjectRequest {
            workspace_id: ws1_id.clone(),
            name: "Moving Project".to_string(),
            project_description: None,
            custom_instructions: None,
            color: None,
            icon: None,
        }).unwrap();

        let temp_dir = tempfile::tempdir().unwrap();
        
        let moved = move_to_workspace(&mut conn, &p.id, &ws2_id, temp_dir.path(), None).unwrap();
        
        assert_eq!(moved.workspace_id, ws2_id);
        assert_eq!(moved.name, "Moving Project");
        
        let ws1_projects = list(&conn, &ws1_id, false).unwrap();
        assert_eq!(ws1_projects.len(), 0);
        
        let ws2_projects = list(&conn, &ws2_id, false).unwrap();
        assert_eq!(ws2_projects.len(), 1);
    }
}
