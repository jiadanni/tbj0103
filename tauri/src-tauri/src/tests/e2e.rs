use crate::models::workspace::CreateWorkspaceRequest;
use crate::models::chat::{CreateChatSessionRequest, AddMessageRequest, MessageRole};
use crate::services::workspace_service;
use crate::services::chat_service;
use crate::db::test_utils::tests::setup_test_db;

#[test]
fn test_critical_path_workspace_chat_message() {
    let pool = setup_test_db();
    let conn = pool.get().unwrap();

    // 1. Create Workspace
    let ws_req = CreateWorkspaceRequest {
        name: "E2E Test Workspace".to_string(),
        description: Some("Created by E2E test".to_string()),
    };
    let workspace = workspace_service::create(&conn, ws_req).expect("Failed to create workspace");
    assert_eq!(workspace.name, "E2E Test Workspace");

    // Use an empty string for folder_id to represent the root/no-folder state.

    // 2. Create Chat Session
    let chat_req = CreateChatSessionRequest {
        workspace_id: workspace.id.clone(),
        folder_id: "".to_string(), // Empty string, not "root" to avoid missing folder lookup, assuming no FK.
        title: Some("E2E Test Chat".to_string()),
        model_name: Some("test-model".to_string()),
        system_prompt: None,
        is_incognito: Some(false),
        exclude_from_analytics: Some(false),
        parent_session_id: None,
        branch_message_id: None,
    };
    let session = chat_service::create_session(&conn, chat_req).expect("Failed to create chat session");
    assert_eq!(session.title, "E2E Test Chat");
    assert_eq!(session.workspace_id, workspace.id);

    // 3. Add Message
    let msg_req = AddMessageRequest {
        workspace_id: workspace.id.clone(),
        session_id: session.id.clone(),
        role: MessageRole::User,
        content: "Hello E2E Test!".to_string(),
        model_name: Some("test-model".to_string()),
        tokens_used: Some(10),
        duration_ms: Some(50),
    };
    let message = chat_service::add_message(&conn, msg_req).expect("Failed to add message");
    assert_eq!(message.content, "Hello E2E Test!");
    assert_eq!(message.role, MessageRole::User);

    // Verify DB State
    let messages = chat_service::get_messages(&conn, &session.id, None, None).expect("Failed to get messages");
    assert_eq!(messages.len(), 1);
    assert_eq!(messages[0].id, message.id);
    assert_eq!(messages[0].content, "Hello E2E Test!");

    let sessions = chat_service::list_sessions(&conn, &workspace.id, "", None, None, true).expect("Failed to list sessions");
    assert_eq!(sessions.len(), 1);
    assert_eq!(sessions[0].id, session.id);
}

#[test]
fn test_critical_path_workspace_chat_message_with_folder() {
    let pool = setup_test_db();
    let conn = pool.get().unwrap();

    // 1. Create Workspace
    let ws_req = CreateWorkspaceRequest {
        name: "E2E Test Workspace 2".to_string(),
        description: Some("Workspace with folder".to_string()),
    };
    let workspace = workspace_service::create(&conn, ws_req).expect("Failed to create workspace");

    // 2. Create Folder
    use crate::models::folder::CreateFolderRequest;
    use crate::services::folder_service;

    let folder_req = CreateFolderRequest {
        workspace_id: workspace.id.clone(),
        name: "Test Folder".to_string(),
        folder_description: Some("A folder for testing".to_string()),
        custom_instructions: None,
        color: None,
        icon: None,
    };
    let folder = folder_service::create(&conn, folder_req).expect("Failed to create folder");

    // 3. Create Chat Session in Folder
    let chat_req = CreateChatSessionRequest {
        workspace_id: workspace.id.clone(),
        folder_id: folder.id.clone(),
        title: Some("Folder Chat".to_string()),
        model_name: Some("test-model".to_string()),
        system_prompt: None,
        is_incognito: Some(false),
        exclude_from_analytics: Some(false),
        parent_session_id: None,
        branch_message_id: None,
    };
    let session = chat_service::create_session(&conn, chat_req).expect("Failed to create chat session");
    assert_eq!(session.folder_id, folder.id);

    // 4. Add Message
    let msg_req = AddMessageRequest {
        workspace_id: workspace.id.clone(),
        session_id: session.id.clone(),
        role: MessageRole::User,
        content: "Message in folder!".to_string(),
        model_name: None,
        tokens_used: None,
        duration_ms: None,
    };
    let message = chat_service::add_message(&conn, msg_req).expect("Failed to add message");

    // Verify DB State
    let messages = chat_service::get_messages(&conn, &session.id, None, None).expect("Failed to get messages");
    assert_eq!(messages.len(), 1);
    assert_eq!(messages[0].id, message.id);

    let sessions = chat_service::list_sessions(&conn, &workspace.id, &folder.id, None, None, true).expect("Failed to list sessions");
    assert_eq!(sessions.len(), 1);
    assert_eq!(sessions[0].id, session.id);
}
