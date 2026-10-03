"""Download pinned official archives into an explicit cache; no installers."""
# SPDX-License-Identifier: MIT
import argparse
import concurrent.futures
import hashlib
import json
import urllib.request
import zipfile
from pathlib import Path, PurePosixPath

parser = argparse.ArgumentParser()
parser.add_argument("--destination", type=Path, required=True)
args = parser.parse_args()
root = args.destination.resolve()
cache = root / "downloads"
cache.mkdir(parents=True, exist_ok=True)
packages = json.loads((Path(__file__).parent / "toolchain-packages.json").read_text(encoding="utf-8-sig"))


def fetch_extract(package):
    archive = cache / package["filename"]
    expected = package["sha256"].lower()
    if not archive.is_file() or hashlib.sha256(archive.read_bytes()).hexdigest() != expected:
        print("Downloading", archive.name, flush=True)
        with urllib.request.urlopen(package["url"].replace(" ", "%20"), timeout=45) as response, archive.open("wb") as output:
            while block := response.read(1024 * 1024):
                output.write(block)
    if hashlib.sha256(archive.read_bytes()).hexdigest() != expected:
        raise RuntimeError(f"SHA256 mismatch: {archive.name}")
    destination = (root / package["destination"]).resolve()
    if not destination.is_relative_to(root):
        raise RuntimeError("Manifest destination escapes cache")
    with zipfile.ZipFile(archive) as source:
        for entry in source.infolist():
            name = entry.filename.replace("\\", "/")
            if entry.is_dir():
                continue
            if package["contentsOnly"]:
                if not name.startswith("Contents/"):
                    continue
                name = name.removeprefix("Contents/")
            target = (destination / Path(*PurePosixPath(name).parts)).resolve()
            if not target.is_relative_to(destination):
                raise RuntimeError("Archive member escapes destination")
            data = source.read(entry)
            if target.is_file() and target.read_bytes() == data:
                continue
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
    print("Verified and extracted", archive.name, flush=True)


with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
    list(pool.map(fetch_extract, packages))
print("Portable files only. Review Microsoft terms; no global environment or registry changes.")
