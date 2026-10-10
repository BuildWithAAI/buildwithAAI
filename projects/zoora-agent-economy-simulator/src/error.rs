use std::fmt;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SimulationError {
    Configuration(&'static str),
    Integrity(&'static str),
    Capacity(&'static str),
    Arithmetic(&'static str),
    Replay(&'static str),
}

impl fmt::Display for SimulationError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let (kind, message) = match self {
            Self::Configuration(message) => ("configuration", message),
            Self::Integrity(message) => ("integrity", message),
            Self::Capacity(message) => ("capacity", message),
            Self::Arithmetic(message) => ("arithmetic", message),
            Self::Replay(message) => ("replay", message),
        };
        write!(f, "{kind}: {message}")
    }
}

impl std::error::Error for SimulationError {}
