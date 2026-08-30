use crate::db::test_utils::tests::setup_test_db;
use crate::models::chat::{AddMessageRequest, CreateChatSessionRequest, MessageRole};
use crate::models::workspace::CreateWorkspaceRequest;
use crate::services::chat_service;
use crate::services::workspace_service;

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
    let session =
        chat_service::create_session(&conn, chat_req).expect("Failed to create chat session");
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
    let messages =
        chat_service::get_messages(&conn, &session.id, None, None).expect("Failed to get messages");
    assert_eq!(messages.len(), 1);
    assert_eq!(messages[0].id, message.id);
    assert_eq!(messages[0].content, "Hello E2E Test!");

    let sessions = chat_service::list_sessions(&conn, &workspace.id, "", None, None, true)
        .expect("Failed to list sessions");
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
    let session =
        chat_service::create_session(&conn, chat_req).expect("Failed to create chat session");
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
    let messages =
        chat_service::get_messages(&conn, &session.id, None, None).expect("Failed to get messages");
    assert_eq!(messages.len(), 1);
    assert_eq!(messages[0].id, message.id);

    let sessions = chat_service::list_sessions(&conn, &workspace.id, &folder.id, None, None, true)
        .expect("Failed to list sessions");
    assert_eq!(sessions.len(), 1);
    assert_eq!(sessions[0].id, session.id);
}

#[test]
fn test_branch_session_forks_prefix_and_preserves_original() {
    let pool = setup_test_db();
    let mut conn = pool.get().unwrap();

    let workspace = workspace_service::create(
        &conn,
        CreateWorkspaceRequest {
            name: "Branch Test Workspace".to_string(),
            description: None,
        },
    )
    .expect("Failed to create workspace");

    let session = chat_service::create_session(
        &conn,
        CreateChatSessionRequest {
            workspace_id: workspace.id.clone(),
            folder_id: "".to_string(),
            title: Some("Branch Source".to_string()),
            model_name: Some("test-model".to_string()),
            system_prompt: Some("be terse".to_string()),
            is_incognito: Some(false),
            exclude_from_analytics: Some(false),
            parent_session_id: None,
            branch_message_id: None,
        },
    )
    .expect("Failed to create chat session");

    // Explicit created_at values so ordering is deterministic regardless of how
    // fast the inserts run.
    let rows = [
        ("m1", "user", "First prompt", "2024-01-01T00:00:00Z"),
        ("m2", "assistant", "First answer", "2024-01-01T00:00:01Z"),
        ("m3", "user", "Second prompt", "2024-01-01T00:00:02Z"),
        ("m4", "assistant", "Second answer", "2024-01-01T00:00:03Z"),
    ];
    for (id, role, content, created_at) in rows {
        conn.execute(
            "INSERT INTO messages (id, session_id, role, content, model_name, tokens_used, duration_ms, variant_group_id, created_at)
             VALUES (?1, ?2, ?3, ?4, NULL, NULL, NULL, NULL, ?5)",
            rusqlite::params![id, session.id, role, content, created_at],
        )
        .expect("Failed to insert message");
    }

    // Branch at the second assistant reply — the prefix is m1..m3.
    let branch = chat_service::branch_session(&mut conn, &workspace.id, &session.id, "m4", None)
        .expect("Failed to branch session");

    assert_eq!(branch.parent_session_id.as_deref(), Some(session.id.as_str()));
    assert_eq!(branch.branch_message_id.as_deref(), Some("m4"));
    assert_eq!(branch.title, "Branch Source (branch)");
    assert_eq!(branch.model_name, "test-model");
    assert_eq!(branch.system_prompt, "be terse");
    assert_eq!(branch.workspace_id, workspace.id);

    let branch_messages = chat_service::get_messages(&conn, &branch.id, None, None)
        .expect("Failed to get branch messages");
    assert_eq!(branch_messages.len(), 3);
    let contents: Vec<&str> = branch_messages.iter().map(|m| m.content.as_str()).collect();
    assert_eq!(contents, vec!["First prompt", "First answer", "Second prompt"]);
    // Copies are distinct rows, re-parented onto the branch.
    for msg in &branch_messages {
        assert_eq!(msg.session_id, branch.id);
        assert!(!["m1", "m2", "m3"].contains(&msg.id.as_str()));
    }

    // The source session is untouched.
    let original_messages = chat_service::get_messages(&conn, &session.id, None, None)
        .expect("Failed to get original messages");
    assert_eq!(original_messages.len(), 4);
    assert_eq!(original_messages[3].id, "m4");

    // Branching at the very first message yields an empty branch.
    let empty_branch =
        chat_service::branch_session(&mut conn, &workspace.id, &session.id, "m1", Some("Fresh".to_string()))
            .expect("Failed to branch at first message");
    assert_eq!(empty_branch.title, "Fresh");
    assert!(chat_service::get_messages(&conn, &empty_branch.id, None, None)
        .expect("Failed to get messages")
        .is_empty());

    // An unknown message id is an error, not a silent empty branch.
    assert!(chat_service::branch_session(&mut conn, &workspace.id, &session.id, "nope", None).is_err());
}
