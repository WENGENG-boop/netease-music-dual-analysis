# Architecture

Provider → catalog → immutable session context → append-only raw events → rebuildable analytics. PostgreSQL is the source of truth; workers consume pg-boss jobs. Provider credentials and playback URLs never enter logs or long-lived track records.
