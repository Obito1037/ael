//! tasks 表 CRUD。

use super::{tags_from_json, tags_to_json, Db};
use crate::error::AelResult;
use crate::models::{NewTask, Task, TaskStatus};
use crate::util::{new_id, now_iso};
use rusqlite::{params, Row};

const COLS: &str =
    "id,title,goal,status,agent_id,repo_path,repo_branch,repo_commit,tags,created_at,updated_at,closed_at";

fn map_task(row: &Row) -> rusqlite::Result<Task> {
    let status_str: String = row.get(3)?;
    let tags_str: String = row.get(8)?;
    Ok(Task {
        id: row.get(0)?,
        title: row.get(1)?,
        goal: row.get(2)?,
        status: TaskStatus::from_db(&status_str).map_err(|e| {
            rusqlite::Error::FromSqlConversionFailure(3, rusqlite::types::Type::Text, Box::new(e))
        })?,
        agent_id: row.get(4)?,
        repo_path: row.get(5)?,
        repo_branch: row.get(6)?,
        repo_commit: row.get(7)?,
        tags: tags_from_json(&tags_str),
        created_at: row.get(9)?,
        updated_at: row.get(10)?,
        closed_at: row.get(11)?,
    })
}

impl Db {
    pub fn create_task(&self, input: NewTask) -> AelResult<Task> {
        let id = new_id();
        let now = now_iso();
        let conn = self.lock();
        conn.execute(
            "INSERT INTO tasks
             (id,title,goal,status,agent_id,repo_path,repo_branch,repo_commit,tags,created_at,updated_at)
             VALUES (?1,?2,?3,'pending',?4,?5,?6,?7,?8,?9,?9)",
            params![
                id,
                input.title,
                input.goal,
                input.agent_id,
                input.repo_path,
                input.repo_branch,
                input.repo_commit,
                tags_to_json(&input.tags),
                now,
            ],
        )?;
        drop(conn);
        self.get_task(&id)
    }

    pub fn get_task(&self, id: &str) -> AelResult<Task> {
        let conn = self.lock();
        let task = conn.query_row(
            &format!("SELECT {COLS} FROM tasks WHERE id=?1"),
            params![id],
            map_task,
        )?;
        Ok(task)
    }

    pub fn list_tasks(
        &self,
        status: Option<TaskStatus>,
        limit: i64,
        offset: i64,
    ) -> AelResult<Vec<Task>> {
        let conn = self.lock();
        let mut out = Vec::new();
        match status {
            Some(s) => {
                let mut stmt = conn.prepare(&format!(
                    "SELECT {COLS} FROM tasks WHERE status=?1 ORDER BY created_at DESC LIMIT ?2 OFFSET ?3"
                ))?;
                let rows = stmt.query_map(params![s.as_str(), limit, offset], map_task)?;
                for r in rows {
                    out.push(r?);
                }
            }
            None => {
                let mut stmt = conn.prepare(&format!(
                    "SELECT {COLS} FROM tasks ORDER BY created_at DESC LIMIT ?1 OFFSET ?2"
                ))?;
                let rows = stmt.query_map(params![limit, offset], map_task)?;
                for r in rows {
                    out.push(r?);
                }
            }
        }
        Ok(out)
    }

    pub fn update_task_status(&self, id: &str, status: TaskStatus) -> AelResult<Task> {
        let now = now_iso();
        // 终态写 closed_at;其余清空。
        let closed_at = matches!(
            status,
            TaskStatus::Verified | TaskStatus::Failed | TaskStatus::Abandoned
        )
        .then(|| now.clone());
        let conn = self.lock();
        let affected = conn.execute(
            "UPDATE tasks SET status=?1, updated_at=?2, closed_at=?3 WHERE id=?4",
            params![status.as_str(), now, closed_at, id],
        )?;
        drop(conn);
        if affected == 0 {
            return Err(crate::error::AelError::not_found(format!(
                "task {id} 不存在"
            )));
        }
        self.get_task(id)
    }

    /// 会话启动后把待开始的任务转为进行中；其他状态是人工决定的，不覆盖。
    pub fn mark_task_started(&self, id: &str) -> AelResult<()> {
        let conn = self.lock();
        conn.execute(
            "UPDATE tasks SET status='in_progress', updated_at=?1 WHERE id=?2 AND status='pending'",
            params![now_iso(), id],
        )?;
        Ok(())
    }

    #[cfg(debug_assertions)]
    pub fn delete_task_for_test(&self, id: &str) -> AelResult<()> {
        let conn = self.lock();
        conn.execute("DELETE FROM tasks WHERE id=?1", params![id])?;
        Ok(())
    }
}
