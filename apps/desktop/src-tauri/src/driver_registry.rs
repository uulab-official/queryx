use std::{collections::HashMap, sync::Arc};

use tokio::sync::RwLock;
use uuid::Uuid;

use crate::{
    driver::{DatabaseDriver, ExecutionMode, QueryChunkHandler},
    error::AppError,
    models::{ConnectionConfig, ConnectionSummary, DatabaseMetadata, DriverKind, QueryResult},
    mysql_driver::MysqlDriver,
    oracle_driver::OracleDriver,
    postgres_driver::PostgresDriver,
    sqlite_driver::SqliteDriver,
    sqlserver_driver::SqlServerDriver,
    ssh_tunnel::SshTunnel,
};

pub struct DriverRegistry {
    connections: RwLock<HashMap<Uuid, Arc<dyn DatabaseDriver>>>,
    tunnels: RwLock<HashMap<Uuid, SshTunnel>>,
}

impl Default for DriverRegistry {
    fn default() -> Self {
        Self {
            connections: RwLock::new(HashMap::new()),
            tunnels: RwLock::new(HashMap::new()),
        }
    }
}

impl DriverRegistry {
    pub async fn connect(&self, config: ConnectionConfig) -> Result<ConnectionSummary, AppError> {
        let tunnel = SshTunnel::start(&config).await?;
        let mut native_config = config;
        if let Some(tunnel) = tunnel.as_ref() {
            native_config.host = Some("127.0.0.1".into());
            native_config.port = Some(tunnel.local_port());
        }
        let read_only = native_config.read_only;
        let driver_result: Result<Arc<dyn DatabaseDriver>, AppError> = match native_config.kind {
            DriverKind::Sqlite => Ok(Arc::new(
                SqliteDriver::connect(&native_config.database, read_only).await?,
            )),
            DriverKind::Postgres => Ok(Arc::new(PostgresDriver::connect(&native_config).await?)),
            DriverKind::Mysql => Ok(Arc::new(MysqlDriver::connect(&native_config).await?)),
            DriverKind::SqlServer => Ok(Arc::new(SqlServerDriver::connect(&native_config).await?)),
            DriverKind::Oracle => Ok(Arc::new(OracleDriver::connect(&native_config).await?)),
        };
        let driver = match driver_result {
            Ok(driver) => driver,
            Err(error) => {
                if let Some(tunnel) = tunnel {
                    tunnel.stop().await;
                }
                return Err(error);
            }
        };
        let id = Uuid::new_v4();
        let summary = ConnectionSummary {
            id: id.to_string(),
            name: native_config.name,
            driver: driver.kind(),
            database: driver.database().to_string(),
            read_only: driver.is_read_only(),
            capabilities: driver.capabilities(),
        };
        self.connections.write().await.insert(id, driver);
        if let Some(tunnel) = tunnel {
            self.tunnels.write().await.insert(id, tunnel);
        }
        Ok(summary)
    }

    pub async fn execute(
        &self,
        connection_id: &str,
        query_id: &str,
        sql: &str,
        mode: ExecutionMode,
    ) -> Result<QueryResult, AppError> {
        let query_id = parse_query_id(query_id)?;
        self.connection(connection_id)
            .await?
            .execute(query_id, sql, mode)
            .await
    }

    pub async fn execute_batch(
        &self,
        connection_id: &str,
        query_id: &str,
        statements: &[String],
        expected_rows: u64,
    ) -> Result<QueryResult, AppError> {
        let query_id = parse_query_id(query_id)?;
        self.connection(connection_id)
            .await?
            .execute_batch(query_id, statements, expected_rows)
            .await
    }

    pub async fn execute_stream(
        &self,
        connection_id: &str,
        query_id: &str,
        sql: &str,
        on_chunk: QueryChunkHandler,
    ) -> Result<QueryResult, AppError> {
        let query_id = parse_query_id(query_id)?;
        self.connection(connection_id)
            .await?
            .execute_stream(query_id, sql, ExecutionMode::Direct, on_chunk)
            .await
    }

    pub async fn begin_transaction(&self, connection_id: &str) -> Result<(), AppError> {
        self.connection(connection_id)
            .await?
            .begin_transaction()
            .await
    }

    pub async fn commit_transaction(&self, connection_id: &str) -> Result<(), AppError> {
        self.connection(connection_id)
            .await?
            .commit_transaction()
            .await
    }

    pub async fn rollback_transaction(&self, connection_id: &str) -> Result<(), AppError> {
        self.connection(connection_id)
            .await?
            .rollback_transaction()
            .await
    }

    pub async fn prepare(&self, connection_id: &str, query_id: &str) -> Result<(), AppError> {
        let query_id = parse_query_id(query_id)?;
        self.connection(connection_id)
            .await?
            .prepare(query_id)
            .await
    }

    pub async fn cancel(&self, connection_id: &str, query_id: &str) -> Result<bool, AppError> {
        let query_id = parse_query_id(query_id)?;
        self.connection(connection_id).await?.cancel(query_id).await
    }

    pub async fn metadata(&self, connection_id: &str) -> Result<DatabaseMetadata, AppError> {
        self.connection(connection_id).await?.metadata().await
    }

    pub async fn sessions(
        &self,
        connection_id: &str,
    ) -> Result<Vec<crate::models::DatabaseSession>, AppError> {
        self.connection(connection_id).await?.sessions().await
    }

    pub async fn cancel_session(
        &self,
        connection_id: &str,
        session_id: &str,
    ) -> Result<(), AppError> {
        self.connection(connection_id)
            .await?
            .cancel_session(session_id)
            .await
    }

    pub async fn locks(
        &self,
        connection_id: &str,
    ) -> Result<Vec<crate::models::DatabaseLock>, AppError> {
        self.connection(connection_id).await?.locks().await
    }

    pub async fn disconnect(&self, connection_id: &str) -> Result<(), AppError> {
        let id = parse_connection_id(connection_id)?;
        let driver = self
            .connections
            .write()
            .await
            .remove(&id)
            .ok_or_else(|| AppError::ConnectionNotFound(connection_id.into()))?;
        let result = driver.disconnect().await;
        if let Some(tunnel) = self.tunnels.write().await.remove(&id) {
            tunnel.stop().await;
        }
        result
    }

    async fn connection(&self, connection_id: &str) -> Result<Arc<dyn DatabaseDriver>, AppError> {
        let id = parse_connection_id(connection_id)?;
        self.connections
            .read()
            .await
            .get(&id)
            .cloned()
            .ok_or_else(|| AppError::ConnectionNotFound(connection_id.into()))
    }
}

fn parse_connection_id(connection_id: &str) -> Result<Uuid, AppError> {
    Uuid::parse_str(connection_id).map_err(|_| AppError::ConnectionNotFound(connection_id.into()))
}

fn parse_query_id(query_id: &str) -> Result<Uuid, AppError> {
    Uuid::parse_str(query_id).map_err(|_| AppError::InvalidQueryId(query_id.into()))
}

#[cfg(test)]
mod tests {
    use serde_json::Value;

    use super::*;

    fn sqlite_config() -> ConnectionConfig {
        ConnectionConfig {
            kind: DriverKind::Sqlite,
            name: "contract-test".into(),
            database: ":memory:".into(),
            host: None,
            port: None,
            username: None,
            password: None,
            ssl_mode: None,
            ssl_root_cert: None,
            ssl_client_cert: None,
            ssl_client_key: None,
            ssh_tunnel: None,
            read_only: false,
        }
    }

    #[tokio::test]
    async fn sqlite_satisfies_the_driver_contract() {
        let registry = DriverRegistry::default();
        let connection = registry
            .connect(sqlite_config())
            .await
            .expect("connect through generic registry");
        let result = registry
            .execute(
                &connection.id,
                &Uuid::new_v4().to_string(),
                "SELECT COUNT(*) AS orders FROM orders",
                ExecutionMode::Direct,
            )
            .await
            .expect("execute through generic registry");
        let metadata = registry
            .metadata(&connection.id)
            .await
            .expect("metadata through generic registry");

        assert_eq!(connection.driver, DriverKind::Sqlite);
        assert!(!connection
            .capabilities
            .contains(&crate::models::DriverCapability::Cancel));
        assert_eq!(result.rows[0]["orders"], Value::from(10));
        assert!(metadata.tables.iter().any(|table| table.name == "orders"));
        registry
            .disconnect(&connection.id)
            .await
            .expect("disconnect through generic registry");
    }

    #[tokio::test]
    async fn sqlite_reports_cancellation_as_unsupported() {
        let registry = DriverRegistry::default();
        let connection = registry
            .connect(sqlite_config())
            .await
            .expect("connect through generic registry");

        let error = registry
            .cancel(&connection.id, &Uuid::new_v4().to_string())
            .await
            .expect_err("SQLite must not advertise fake cancellation");

        assert!(matches!(error, AppError::CancellationUnsupported(_)));
    }

    #[tokio::test]
    async fn sqlite_read_only_rejects_writes() {
        let registry = DriverRegistry::default();
        let mut config = sqlite_config();
        config.read_only = true;
        let connection = registry
            .connect(config)
            .await
            .expect("connect read-only SQLite");

        assert!(connection.read_only);
        assert!(!connection
            .capabilities
            .contains(&crate::models::DriverCapability::Editing));
        let error = registry
            .execute(
                &connection.id,
                &Uuid::new_v4().to_string(),
                "UPDATE orders SET status = 'blocked' WHERE id = 1",
                ExecutionMode::Direct,
            )
            .await
            .expect_err("read-only SQLite must reject writes");
        assert!(error.to_string().contains("readonly"));

        let result = registry
            .execute(
                &connection.id,
                &Uuid::new_v4().to_string(),
                "SELECT status FROM orders WHERE id = 1",
                ExecutionMode::Direct,
            )
            .await
            .expect("read-only SQLite still allows reads");
        assert_eq!(result.rows[0]["status"], Value::from("paid"));
    }
}
