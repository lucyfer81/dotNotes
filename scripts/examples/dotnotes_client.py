from __future__ import annotations

import json
import os
from dataclasses import dataclass
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


@dataclass(slots=True)
class ImportedTag:
    id: str
    name: str


@dataclass(slots=True)
class ImportedNote:
    note_id: str
    title: str
    slug: str
    folder_id: str
    created: bool
    tags: list[ImportedTag]


class DotNotesClientError(RuntimeError):
    def __init__(self, message: str, status: int, details: str | None = None) -> None:
        super().__init__(message)
        self.status = status
        self.details = details


class DotNotesClient:
    def __init__(self, base_url: str, shared_token: str) -> None:
        self.base_url = base_url.rstrip("/")
        self.shared_token = shared_token

    def import_note(
        self,
        *,
        title: str,
        content: str,
        tags: list[str] | None = None,
        folder: str | None = None,
        folder_id: str | None = None,
    ) -> ImportedNote:
        payload = {
            "title": title,
            "content": content,
            "tags": tags or [],
            "folder": folder,
            "folderId": folder_id,
        }
        request = Request(
            url=f"{self.base_url}/api/internal/notes/imports",
            method="POST",
            headers={
                "Accept": "application/json",
                "Content-Type": "application/json",
                "x-dotfamily-internal-token": self.shared_token,
            },
            data=json.dumps(payload).encode("utf-8"),
        )

        try:
            with urlopen(request) as response:
                body = response.read().decode("utf-8")
                status = response.status
        except HTTPError as error:
            body = error.read().decode("utf-8", errors="replace")
            self._raise_from_response(error.code, body)
        except URLError as error:
            raise DotNotesClientError(f"dotNotes import request failed: {error}", 0) from error

        envelope = json.loads(body)
        if status >= 400 or envelope.get("ok") is not True:
            self._raise_from_response(status, body)

        data = envelope["data"]
        return ImportedNote(
            note_id=data["noteId"],
            title=data["title"],
            slug=data["slug"],
            folder_id=data["folderId"],
            created=bool(data["created"]),
            tags=[ImportedTag(id=item["id"], name=item["name"]) for item in data.get("tags", [])],
        )

    def _raise_from_response(self, status: int, body: str) -> None:
        try:
            payload = json.loads(body)
        except json.JSONDecodeError as error:
            raise DotNotesClientError("dotNotes import request failed", status, body) from error

        message = payload.get("error") or "dotNotes import request failed"
        details = payload.get("details")
        raise DotNotesClientError(str(message), status, None if details is None else str(details))


def main() -> None:
    base_url = os.environ.get("DOTNOTES_BASE_URL", "")
    shared_token = os.environ.get("DOTNOTES_SHARED_TOKEN", "")
    if not base_url or not shared_token:
        raise SystemExit("DOTNOTES_BASE_URL and DOTNOTES_SHARED_TOKEN are required")

    client = DotNotesClient(base_url=base_url, shared_token=shared_token)
    created = client.import_note(
        title="Python client example",
        content="Imported from scripts/examples/dotnotes_client.py",
        tags=["example", "python"],
        folder="00-Inbox",
    )
    print(json.dumps(
        {
            "noteId": created.note_id,
            "title": created.title,
            "slug": created.slug,
            "folderId": created.folder_id,
            "created": created.created,
            "tags": [{"id": tag.id, "name": tag.name} for tag in created.tags],
        },
        ensure_ascii=False,
        indent=2,
    ))


if __name__ == "__main__":
    main()
