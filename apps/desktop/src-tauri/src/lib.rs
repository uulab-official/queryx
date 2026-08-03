mod commands;
mod driver;
mod driver_registry;
mod error;
mod models;
mod sqlite_driver;

use driver_registry::DriverRegistry;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(DriverRegistry::default())
        .invoke_handler(tauri::generate_handler![
            commands::connect_database,
            commands::execute_query,
            commands::execute_query_transaction,
            commands::database_metadata,
            commands::disconnect_database,
        ])
        .run(tauri::generate_context!())
        .expect("error while running QueryX");
}
