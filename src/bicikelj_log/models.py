import json
from dataclasses import asdict, dataclass


@dataclass(frozen=True)
class StatusRow:
    ts: int
    station_id: str
    bikes: int
    docks: int
    bikes_disabled: int
    docks_disabled: int
    is_installed: bool
    is_renting: bool
    is_returning: bool
    last_reported: int | None


def status_rows(status_feed: dict) -> list[StatusRow]:
    ts = status_feed["last_updated"]
    stations = status_feed["data"]["stations"]
    rows: list[StatusRow] = []
    for s in stations:
        rows.append(
            StatusRow(
                ts=ts,
                station_id=str(s["station_id"]),
                bikes=s["num_vehicles_available"],
                docks=s["num_docks_available"],
                bikes_disabled=s.get("num_vehicles_disabled", 0),
                docks_disabled=s.get("num_docks_disabled", 0),
                is_installed=s.get("is_installed", False),
                is_renting=s.get("is_renting", False),
                is_returning=s.get("is_returning", False),
                last_reported=s.get("last_reported"),
            )
        )
    return rows


def rows_to_jsonl(rows: list[StatusRow]) -> bytes:
    lines = [json.dumps(asdict(r), separators=(",", ":")) for r in rows]
    return ("\n".join(lines) + "\n").encode("utf-8")
