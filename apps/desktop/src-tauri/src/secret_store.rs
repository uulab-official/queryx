use crate::error::AppError;

const KEYCHAIN_SERVICE: &str = "com.uulab.queryx";

fn entry_for_profile(profile_id: &str) -> Result<keyring::Entry, AppError> {
    let profile_id = profile_id.trim();
    if profile_id.is_empty() {
        return Err(AppError::Keychain("profile id is required".into()));
    }
    keyring::Entry::new(KEYCHAIN_SERVICE, &format!("profile:{profile_id}"))
        .map_err(|error| AppError::Keychain(error.to_string()))
}

pub fn load_password(profile_id: &str) -> Result<Option<String>, AppError> {
    match entry_for_profile(profile_id)?.get_password() {
        Ok(password) => Ok(Some(password)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(AppError::Keychain(error.to_string())),
    }
}

pub fn save_password(profile_id: &str, password: &str) -> Result<(), AppError> {
    if password.is_empty() {
        return delete_password(profile_id);
    }
    entry_for_profile(profile_id)?
        .set_password(password)
        .map_err(|error| AppError::Keychain(error.to_string()))
}

pub fn delete_password(profile_id: &str) -> Result<(), AppError> {
    match entry_for_profile(profile_id)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(AppError::Keychain(error.to_string())),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_empty_profile_ids_before_touching_the_keychain() {
        let error = match entry_for_profile(" ") {
            Ok(_) => panic!("blank profile id must be rejected"),
            Err(error) => error,
        };
        assert!(matches!(error, AppError::Keychain(message) if message.contains("profile id")));
    }
}
