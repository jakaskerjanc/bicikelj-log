import json


def log(**fields) -> None:
    print(json.dumps(fields, separators=(",", ":")), flush=True)
