"""Install the pinned PocketBase binary and copy the local AMIS SDK."""
import hashlib
import io
import pathlib
import platform
import shutil
import urllib.request
import zipfile

root = pathlib.Path(__file__).resolve().parent.parent
version = "0.40.4"
system = {"Darwin": "darwin", "Linux": "linux", "Windows": "windows"}[platform.system()]
arch = {"arm64": "arm64", "aarch64": "arm64", "x86_64": "amd64", "AMD64": "amd64"}[platform.machine()]
name = f"pocketbase_{version}_{system}_{arch}.zip"
base = f"https://github.com/pocketbase/pocketbase/releases/download/v{version}/"
target = root / ".tools" / ("pocketbase.exe" if system == "windows" else "pocketbase")
target.parent.mkdir(exist_ok=True)
if not target.exists():
    archive = urllib.request.urlopen(base + name, timeout=60).read()
    checks = urllib.request.urlopen(base + "checksums.txt", timeout=60).read().decode()
    expected = next(line.split()[0] for line in checks.splitlines() if line.split()[-1] == name)
    if hashlib.sha256(archive).hexdigest() != expected:
        raise RuntimeError("PocketBase checksum mismatch")
    with zipfile.ZipFile(io.BytesIO(archive)) as bundle:
        target.write_bytes(bundle.read(target.name))
    target.chmod(0o755)
shutil.copytree(root / "node_modules/amis/sdk", root / "pb_public/vendor", dirs_exist_ok=True)
print(f"PocketBase {version} and AMIS ready. Run npm start.")
