use std::{collections::HashMap, sync::Arc};

use tokio::sync::RwLock;
use uuid::Uuid;

use crate::{
    driver::{DatabaseDriver, ExecutionMode},
    error::AppError,
    models::{ConnectionConfig, ConnectionSummary, DatabaseMetadata, DriverKind, QueryResult},
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
            kind => return Err(AppError::UnsupportedDriver(kind.to_string())),
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
        sql: &str,
        mode: ExecutionMode,
    ) -> Result<QueryResult, AppError> {
        self.connection(connection_id)
            .await?
            .execute(sql, mode)
            .await
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

#[cfg(test)]
mod tests {
    use serde_json::Value;

    use super::*;

    fn sqlite_config() -> ConnectionConfig {
        ConnectionConfig {
            kind: DriverKind::Sqlite,
            name: "contract-test".into(),
            database: ":memory:".into(),
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
        assert_eq!(result.rows[0]["orders"], Value::from(10));
        assert!(metadata.tables.iter().any(|table| table.name == "orders"));
        registry
            .disconnect(&connection.id)
            .await
            .expect("disconnect through generic registry");
    }

    #[tokio::test]
    async fn unsupported_drivers_fail_at_the_factory_boundary() {
        let registry = DriverRegistry::default();
        let error = registry
            .connect(ConnectionConfig {
                kind: DriverKind::Postgres,
                name: "not-ready".into(),
                database: "postgres".into(),
            })
            .await
            .expect_err("postgres is not implemented yet");

        assert!(matches!(error, AppError::UnsupportedDriver(_)));
    }
}
