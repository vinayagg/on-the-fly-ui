"""Report readable source lines; no minification or generated-code exclusions."""
from pathlib import Path
root = Path(__file__).resolve().parent.parent
files = sorted(p for folder in ["pb_hooks", "pb_migrations", "pb_public", "scripts", "test"]
               for p in (root / folder).rglob("*")
               if p.is_file() and "vendor" not in p.parts and p.suffix in [".js", ".mjs", ".py", ".html", ".css"])
total = 0
for path in files:
    lines = len(path.read_text().splitlines())
    total += lines
    print(f"{lines:4}  {path.relative_to(root)}")
print(f"{total:4}  TOTAL (includes blanks, comments, tests, setup, HTML and CSS)")
for folder in ["examples", "schema"]:
    paths = list((root / folder).glob("*.json"))
    print(f"{sum(len(p.read_text().splitlines()) for p in paths):4}  {folder}: declarative JSON lines, reported separately")
