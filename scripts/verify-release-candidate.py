#!/usr/bin/env python3
"""Read-only validation of a frozen public release and its canonical digest."""
import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath


ALGORITHM = (
    "SHA-256 of files in ascending UTF-8 byte order of their complete POSIX "
    "upload-relative path; for each file append path UTF-8 + NUL + ASCII decimal "
    "byte length + NUL + raw bytes. Excludes only root .vercel metadata."
)


def verify(receipt_path):
    receipt = json.loads(Path(receipt_path).read_text())
    root = Path(receipt["candidate"])
    if not root.is_absolute() or root.is_symlink() or not root.is_dir():
        raise ValueError("Candidate must be an absolute, non-symlink directory")
    expected = receipt["candidate_file_sha256"]
    if not isinstance(expected, dict) or not expected:
        raise ValueError("Missing frozen file manifest")
    for relative in expected:
        path = PurePosixPath(relative)
        if path.is_absolute() or path.as_posix() != relative or ".." in path.parts or "\\" in relative:
            raise ValueError("Unsafe manifest path")
        if relative != "vercel.json" and not relative.startswith("dist/"):
            raise ValueError("Manifest includes non-public deployment input")
    actual = set()
    for directory, folders, files in os.walk(root, followlinks=False):
        for name in folders + files:
            path = Path(directory) / name
            if path.is_symlink():
                raise ValueError("Candidate contains a symlink")
        if Path(directory) == root and ".vercel" in folders:
            folders.remove(".vercel")
        for name in files:
            path = Path(directory) / name
            if not path.is_file():
                raise ValueError("Candidate contains a non-regular file")
            actual.add(path.relative_to(root).as_posix())
    if actual != set(expected):
        raise ValueError("Candidate file inventory does not match frozen manifest")
    digest = hashlib.sha256()
    total = 0
    # Sort complete relative strings, never Path objects (component ordering).
    for relative in sorted(actual, key=lambda value: value.encode("utf-8")):
        data = (root / relative).read_bytes()
        if hashlib.sha256(data).hexdigest() != expected[relative]:
            raise ValueError("Candidate file bytes do not match frozen manifest")
        total += len(data)
        digest.update(relative.encode("utf-8") + b"\0")
        digest.update(str(len(data)).encode("ascii") + b"\0")
        digest.update(data)
    calculated = digest.hexdigest()
    if calculated != receipt["deployment_input_sha256"]:
        raise ValueError("Canonical deployment input digest does not match receipt")
    public_count = sum(relative.startswith("dist/") for relative in actual)
    if (len(actual), total, public_count) != (
        receipt["upload_file_count"], receipt["upload_bytes"], receipt["public_file_count"]
    ):
        raise ValueError("Candidate counts do not match receipt")
    return {"verified": True, "deployment_input_sha256": calculated,
            "upload_file_count": len(actual), "upload_bytes": total,
            "public_file_count": public_count, "algorithm": ALGORITHM}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("receipt", type=Path)
    args = parser.parse_args()
    try:
        print(json.dumps(verify(args.receipt), indent=2))
    except (ValueError, KeyError, TypeError, OSError) as error:
        parser.exit(1, f"Release validation failed: {error}\n")
