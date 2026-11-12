"""Save verified hourly snapshots of the ValveMap database."""
from contextlib import closing
from datetime import datetime
from pathlib import Path
import os
import sqlite3
import tempfile

data = Path.home() / "Library/Application Support/ValveMap/atlas.sqlite"
dest = Path.home() / "Library/Application Support/ValveMapBackups"
os.umask(0o077)
dest.mkdir(mode=0o700, parents=True, exist_ok=True)
fd, name = tempfile.mkstemp(prefix=".snapshot-", suffix=".sqlite", dir=dest)
os.close(fd)
tmp = Path(name)
try:
    with closing(sqlite3.connect(f"file:{data}?mode=ro", uri=True)) as live:
        with closing(sqlite3.connect(tmp)) as snapshot:
            live.backup(snapshot)
            if snapshot.execute("PRAGMA integrity_check").fetchone() != ("ok",):
                raise RuntimeError("Snapshot integrity check failed")
            snapshot.execute("PRAGMA journal_mode=DELETE")
    target = dest / ("atlas-" + datetime.now().strftime("%Y-%m-%d-%H") + ".sqlite")
    os.replace(tmp, target)
    for old in sorted(dest.glob("atlas-????-??-??-??.sqlite"))[:-336]:
        old.unlink()
finally:
    tmp.unlink(missing_ok=True)
