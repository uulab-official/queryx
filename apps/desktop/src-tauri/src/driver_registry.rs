use std::{collections::HashMap, sync::Arc};

use tokio::sync::RwLock;
use uuid::Uuid;

use crate::{
    driver::{DatabaseDriver, ExecutionMode},
    error::AppError,
    models::{ConnectionConfig, ConnectionSummary, DatabaseMetadata, DriverKind, QueryResult},
    postgres_driver::PostgresDriver,
    sqlite_driver::SqliteDriver,
};

pub struct DriverRegistry {
    connections: RwLock<HashMap<Uuid, Arc<dyn DatabaseDriver>>>,
}

impl Default for DriverRegistry {
    fn default() -> Self {
        Self {
            connections: RwLock::new(HashMap::new()),
        }
    }
}

impl DriverRegistry {
    pub async fn connect(&self, config: ConnectionConfig) -> Result<ConnectionSummary, AppError> {
        let driver: Arc<dyn DatabaseDriver> = match config.kind {
            DriverKind::Sqlite => Arc::new(SqliteDriver::connect(&config.database).await?),
            DriverKind::Postgres => Arc::new(PostgresDriver::connect(&config).await?),
            DriverKind::Mysql => return Err(AppError::UnsupportedDriver(config.kind.to_string())),
        };
        let id = Uuid::new_v4();
        let summary = ConnectionSummary {
            id: id.to_string(),
            name: config.name,
            driver: driver.kind(),
            database: driver.database().to_string(),
            capabilities: driver.capabilities(),
        };
        self.connections.write().await.insert(id, driver);
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

    pub async fn disconnect(&self, connection_id: &str) -> Result<(), AppError> {
        let id = parse_connection_id(connection_id)?;
        let driver = self
            .connections
            .write()
            .await
            .remove(&id)
            .ok_or_else(|| AppError::ConnectionNotFound(connection_id.into()))?;
        driver.disconnect().await
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
    async fn unsupported_drivers_fail_at_the_factory_boundary() {
        let registry = DriverRegistry::default();
        let error = registry
            .connect(ConnectionConfig {
                kind: DriverKind::Mysql,
                name: "not-ready".into(),
                database: "mysql".into(),
                host: None,
                port: None,
                username: None,
                password: None,
                ssl_mode: None,
            })
            .await
            .expect_err("mysql is not implemented yet");

        assert!(matches!(error, AppError::UnsupportedDriver(_)));
    }
}
