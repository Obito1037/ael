#[allow(dead_code)]
mod common;

use ael3_lib::agent::config::{
    backup_config_target, list_config_targets_with_home, read_config_target_with_home,
    write_config_target_with_home,
};
use std::fs;

fn prepare_dirs() -> (std::path::PathBuf, std::path::PathBuf, std::path::PathBuf) {
    let root = common::unique_dir();
    let home = root.join("home");
    let cwd = root.join("repo");
    let backups = root.join("backups");
    fs::create_dir_all(&home).unwrap();
    fs::create_dir_all(&cwd).unwrap();
    fs::create_dir_all(&backups).unwrap();
    (home, cwd, backups)
}

#[test]
fn lists_fixed_global_and_project_config_targets() {
    let (home, cwd, _) = prepare_dirs();

    let targets =
        list_config_targets_with_home(Some(cwd.to_string_lossy().to_string()), Some(home.clone()))
            .unwrap();

    assert_eq!(targets.len(), 9);
    let codex_global = targets
        .iter()
        .find(|target| target.id == "codex_global")
        .unwrap();
    assert_eq!(codex_global.agent_id, "codex");
    assert!(
        codex_global.path.ends_with(".codex\\config.toml")
            || codex_global.path.ends_with(".codex/config.toml")
    );

    let claude_project = targets
        .iter()
        .find(|target| target.id == "claude_project")
        .unwrap();
    assert_eq!(claude_project.agent_id, "claude_code");
    assert!(claude_project.path.ends_with("CLAUDE.md"));
}

#[test]
fn writes_reads_and_backs_up_project_context_file() {
    let (home, cwd, backups) = prepare_dirs();
    let cwd_arg = Some(cwd.to_string_lossy().to_string());

    let first = write_config_target_with_home(
        "codex_project",
        cwd_arg.clone(),
        "first version\n".into(),
        false,
        &backups,
        Some(home.clone()),
    )
    .unwrap();
    assert_eq!(first.backup_path, None);
    assert_eq!(first.bytes_written, "first version\n".len());
    assert!(first.target.exists);

    let read_back =
        read_config_target_with_home("codex_project", cwd_arg.clone(), Some(home.clone())).unwrap();
    assert_eq!(read_back.content, "first version\n");

    let second = write_config_target_with_home(
        "codex_project",
        cwd_arg.clone(),
        "second version\n".into(),
        true,
        &backups,
        Some(home.clone()),
    )
    .unwrap();
    let backup_path = second.backup_path.expect("backup should be created");
    assert_eq!(fs::read_to_string(&backup_path).unwrap(), "first version\n");

    let final_read = read_config_target_with_home("codex_project", cwd_arg, Some(home)).unwrap();
    assert_eq!(final_read.content, "second version\n");
}

#[test]
fn writes_global_config_with_parent_dirs() {
    let (home, cwd, backups) = prepare_dirs();

    let written = write_config_target_with_home(
        "claude_global",
        Some(cwd.to_string_lossy().to_string()),
        "{\n  \"permissions\": {}\n}\n".into(),
        true,
        &backups,
        Some(home.clone()),
    )
    .unwrap();

    assert!(written.backup_path.is_none());
    assert!(
        written.target.path.ends_with(".claude\\settings.json")
            || written.target.path.ends_with(".claude/settings.json")
    );
    assert_eq!(
        fs::read_to_string(home.join(".claude").join("settings.json")).unwrap(),
        "{\n  \"permissions\": {}\n}\n"
    );
}

#[test]
fn explicit_backup_returns_none_when_target_is_missing() {
    let (home, cwd, backups) = prepare_dirs();

    let backup = backup_config_target(
        "gemini_project",
        Some(cwd.to_string_lossy().to_string()),
        &backups,
    )
    .unwrap();

    assert_eq!(backup, None);
    assert!(home.exists());
}

#[test]
fn rejects_unknown_target_and_missing_project_cwd() {
    let (home, cwd, backups) = prepare_dirs();

    let unknown = write_config_target_with_home(
        "missing_agent_config",
        Some(cwd.to_string_lossy().to_string()),
        "content".into(),
        true,
        &backups,
        Some(home.clone()),
    )
    .unwrap_err();
    assert_eq!(unknown.code, "invalid_input");

    let missing_cwd = cwd.join("does-not-exist");
    let bad_cwd = read_config_target_with_home(
        "codex_project",
        Some(missing_cwd.to_string_lossy().to_string()),
        Some(home),
    )
    .unwrap_err();
    assert_eq!(bad_cwd.code, "not_found");
}
