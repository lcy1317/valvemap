"""Install the application and backup as system launchd jobs."""
import os
from pathlib import Path
import plistlib
import subprocess
import sys

ROOT = Path("/Users/lcy/valvemap")
DATA = Path("/Users/lcy/Library/Application Support/ValveMap")
NODE = "/opt/homebrew/bin/node"
LABEL = "net.olven.valvemap"


def install():
    if os.geteuid() != 0:
        raise RuntimeError("Administrator privileges are required")
    app = Path("/Library/LaunchDaemons") / (LABEL + ".plist")
    backup = Path("/Library/LaunchDaemons") / (LABEL + ".backup.plist")
    if app.exists() or backup.exists():
        raise RuntimeError("ValveMap launch service already exists")
    if not (ROOT / "server.cjs").is_file() or not (DATA / "atlas.sqlite").is_file():
        raise RuntimeError("Application or migration snapshot is missing")
    common = {"UserName": "lcy", "WorkingDirectory": str(ROOT)}
    config = dict(common, Label=LABEL,
                  ProgramArguments=[NODE, str(ROOT / "server.cjs")],
                  EnvironmentVariables={"DATA_DIR": str(DATA), "PORT": "8888", "HOST": "127.0.0.1"},
                  RunAtLoad=True, KeepAlive=True, ThrottleInterval=10,
                  StandardOutPath=str(DATA / "service.out.log"),
                  StandardErrorPath=str(DATA / "service.err.log"))
    backup_config = dict(common, Label=LABEL + ".backup",
                         ProgramArguments=["/usr/bin/python3", str(ROOT / "deploy/macos_backup.py")],
                         RunAtLoad=True, StartInterval=3600,
                         StandardOutPath=str(DATA / "backup.out.log"),
                         StandardErrorPath=str(DATA / "backup.err.log"))
    for path, value in ((app, config), (backup, backup_config)):
        with path.open("xb") as stream:
            os.fchmod(stream.fileno(), 0o644)
            plistlib.dump(value, stream)
    subprocess.run(["/bin/launchctl", "bootstrap", "system", str(app)], check=True)
    subprocess.run(["/bin/launchctl", "bootstrap", "system", str(backup)], check=True)
    print("ValveMap services installed", flush=True)


if __name__ == "__main__":
    if "--install" in sys.argv:
        install()
    else:
        password = sys.stdin.readline()
        if not password.strip():
            raise RuntimeError("Missing administrator password")
        result = subprocess.run(["/usr/bin/sudo", "-S", "-p", "", "/usr/bin/python3",
                                 os.path.abspath(__file__), "--install"],
                                input=password, text=True)
        sys.exit(result.returncode)
