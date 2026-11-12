"""Take an online, integrity-checked snapshot of the entire application database."""
import os
from pathlib import Path
import sqlite3
import sys
from contextlib import closing

source, destination = map(Path, sys.argv[1:])
if destination.exists():
    raise SystemExit("Refusing to overwrite an existing snapshot")
os.umask(0o077)
with closing(sqlite3.connect(f"file:{source}?mode=ro", uri=True)) as live:
    with closing(sqlite3.connect(destination)) as snapshot:
        live.backup(snapshot)
        if snapshot.execute("PRAGMA integrity_check").fetchone() != ("ok",):
            raise SystemExit("Database integrity check failed")
        snapshot.execute("PRAGMA journal_mode=DELETE")
        print("snapshot", snapshot.execute("SELECT COUNT(*) FROM plans").fetchone()[0],
              snapshot.execute("SELECT COUNT(*) FROM valves").fetchone()[0], flush=True)
