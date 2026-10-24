"""Run the upstream NexFlow desktop web demo on Replit's public interface."""

import os
from pathlib import Path
from tempfile import TemporaryDirectory

import uvicorn

from backend.desktop_demo import create_demo_app


def main() -> None:
    port = int(os.environ.get("PORT", "5000"))
    with TemporaryDirectory(prefix="nexflow-replit-") as folder:
        app = create_demo_app(Path(folder) / "demo.sqlite3")
        uvicorn.run(app, host="0.0.0.0", port=port)


if __name__ == "__main__":
    main()
