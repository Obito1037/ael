//! Provider / MCP server 配置持久化。
//! 结构 serde camelCase,与前端 src/types.ts 的 ProviderConfig / MCPServerConfig 逐字段对齐。

use super::Db;
use crate::error::AelResult;
use crate::util::{new_id, now_iso};
use rusqlite::{params, OptionalExtension, Row};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderConfig {
    #[serde(default)]
    pub id: String,
    pub name: String,
    pub target_app: String, // 'claude' | 'codex' | 'gemini' | 'universal'
    #[serde(default)]
    pub model: String,
    #[serde(default)]
    pub endpoint: String,
    #[serde(default)]
    pub api_key: String,
    #[serde(default = "default_true")]
    pub is_active: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpServerConfig {
    #[serde(default)]
    pub id: String,
    pub name: String,
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub env: BTreeMap<String, String>,
    #[serde(default = "default_true")]
    pub is_active: bool,
}

const PROVIDER_COLS: &str = "id,name,target_app,model,endpoint,api_key,is_active,notes";
const MCP_COLS: &str = "id,name,command,args,env,is_active";

fn map_provider(row: &Row) -> rusqlite::Result<ProviderConfig> {
    let active: i64 = row.get(6)?;
    Ok(ProviderConfig {
        id: row.get(0)?,
        name: row.get(1)?,
        target_app: row.get(2)?,
        model: row.get(3)?,
        endpoint: row.get(4)?,
        api_key: row.get(5)?,
        is_active: active == 1,
        notes: row.get(7)?,
    })
}

fn map_mcp(row: &Row) -> rusqlite::Result<McpServerConfig> {
    let args: String = row.get(3)?;
    let env: String = row.get(4)?;
    let active: i64 = row.get(5)?;
    Ok(McpServerConfig {
        id: row.get(0)?,
        name: row.get(1)?,
        command: row.get(2)?,
        args: serde_json::from_str(&args).unwrap_or_default(),
        env: serde_json::from_str(&env).unwrap_or_default(),
        is_active: active == 1,
    })
}

impl Db {
    pub fn list_providers(&self) -> AelResult<Vec<ProviderConfig>> {
        let conn = self.lock();
        let mut stmt = conn.prepare(&format!(
            "SELECT {PROVIDER_COLS} FROM providers ORDER BY name ASC"
        ))?;
        let rows = stmt.query_map([], map_provider)?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r?);
        }
        Ok(out)
    }

    pub fn get_provider(&self, id: &str) -> AelResult<Option<ProviderConfig>> {
        let conn = self.lock();
        let r = conn
            .query_row(
                &format!("SELECT {PROVIDER_COLS} FROM providers WHERE id=?1"),
                params![id],
                map_provider,
            )
            .optional()?;
        Ok(r)
    }

    /// upsert;若入参 api_key 为空,则保留已存库中的旧密钥(避免被脱敏/空值覆盖)。
    pub fn upsert_provider(&self, p: &ProviderConfig) -> AelResult<String> {
        let id = if p.id.trim().is_empty() {
            new_id()
        } else {
            p.id.clone()
        };
        let key = if p.api_key.is_empty() {
            self.get_provider(&id)?
                .map(|e| e.api_key)
                .unwrap_or_default()
        } else {
            p.api_key.clone()
        };
        let now = now_iso();
        let conn = self.lock();
        conn.execute(
            "INSERT INTO providers
             (id,name,target_app,model,endpoint,api_key,is_active,notes,created_at,updated_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?9)
             ON CONFLICT(id) DO UPDATE SET
               name=excluded.name,
               target_app=excluded.target_app,
               model=excluded.model,
               endpoint=excluded.endpoint,
               api_key=excluded.api_key,
               is_active=excluded.is_active,
               notes=excluded.notes,
               updated_at=excluded.updated_at",
            params![
                id,
                p.name,
                p.target_app,
                p.model,
                p.endpoint,
                key,
                p.is_active as i64,
                p.notes,
                now
            ],
        )?;
        Ok(id)
    }

    pub fn delete_provider(&self, id: &str) -> AelResult<()> {
        let conn = self.lock();
        conn.execute("DELETE FROM providers WHERE id=?1", params![id])?;
        Ok(())
    }

    pub fn list_mcp_servers(&self) -> AelResult<Vec<McpServerConfig>> {
        let conn = self.lock();
        let mut stmt = conn.prepare(&format!(
            "SELECT {MCP_COLS} FROM mcp_servers ORDER BY name ASC"
        ))?;
        let rows = stmt.query_map([], map_mcp)?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r?);
        }
        Ok(out)
    }

    pub fn upsert_mcp_server(&self, m: &McpServerConfig) -> AelResult<String> {
        let id = if m.id.trim().is_empty() {
            new_id()
        } else {
            m.id.clone()
        };
        let args = serde_json::to_string(&m.args).unwrap_or_else(|_| "[]".into());
        let env = serde_json::to_string(&m.env).unwrap_or_else(|_| "{}".into());
        let now = now_iso();
        let conn = self.lock();
        conn.execute(
            "INSERT INTO mcp_servers
             (id,name,command,args,env,is_active,created_at,updated_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?7)
             ON CONFLICT(id) DO UPDATE SET
               name=excluded.name,
               command=excluded.command,
               args=excluded.args,
               env=excluded.env,
               is_active=excluded.is_active,
               updated_at=excluded.updated_at",
            params![id, m.name, m.command, args, env, m.is_active as i64, now],
        )?;
        Ok(id)
    }

    pub fn delete_mcp_server(&self, id: &str) -> AelResult<()> {
        let conn = self.lock();
        conn.execute("DELETE FROM mcp_servers WHERE id=?1", params![id])?;
        Ok(())
    }
}
