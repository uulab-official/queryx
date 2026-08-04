mod commands;
mod driver;
mod driver_registry;
mod error;
mod models;
mod mysql_driver;
mod postgres_driver;
mod sqlite_driver;

use driver_registry::DriverRegistry;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(DriverRegistry::default())
        .invoke_handler(tauri::generate_handler![
            commands::connect_database,
            commands::prepare_query,
            commands::execute_query,
            commands::execute_query_transaction,
            commands::execute_edit_batch,
            commands::cancel_query,
            commands::database_metadata,
            commands::disconnect_database,
        ])
        .run(tauri::generate_context!())
        .expect("error while running QueryX");
}
