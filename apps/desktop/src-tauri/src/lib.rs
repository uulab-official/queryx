mod commands;
mod error;
mod models;
mod sqlite_driver;

use sqlite_driver::SqliteDriverRegistry;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(SqliteDriverRegistry::default())
        .invoke_handler(tauri::generate_handler![
            commands::connect_sqlite,
            commands::execute_sqlite,
            commands::execute_sqlite_transaction,
            commands::sqlite_metadata,
            commands::disconnect_sqlite,
        ])
        .run(tauri::generate_context!())
        .expect("error while running QueryX");
}
