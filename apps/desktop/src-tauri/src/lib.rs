mod commands;
mod driver;
mod driver_registry;
mod error;
mod models;
mod mysql_driver;
mod oracle_driver;
mod postgres_driver;
mod secret_store;
mod sqlite_driver;
mod sqlserver_driver;
mod ssh_tunnel;

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
            commands::execute_query_stream,
            commands::begin_transaction,
            commands::commit_transaction,
            commands::rollback_transaction,
            commands::load_connection_password,
            commands::save_connection_password,
            commands::delete_connection_password,
            commands::execute_edit_batch,
            commands::cancel_query,
            commands::database_metadata,
            commands::database_sessions,
            commands::cancel_database_session,
            commands::database_locks,
            commands::disconnect_database,
        ])
        .run(tauri::generate_context!())
        .expect("error while running QueryX");
}
