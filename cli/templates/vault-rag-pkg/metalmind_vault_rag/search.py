"""Pure search functions — shared by the MCP server, the HTTP server, and anything else that wants them. No MCP/HTTP coupling here."""
import re
from pathlib import Path

from .core import COLLECTION, VAULT, embed, files_to_index, qdrant

WIKILINK = re.compile(r"\[\[([^\]|#]+)(?:[#|][^\]]*)?\]\]")


def parse_links(text: str) -> list[str]:
    return list({m.group(1).strip() for m in WIKILINK.finditer(text)})


def file_index() -> dict[str, Path]:
    return {p.stem: p for p in files_to_index()}


def search_vault(query: str, k: int = 5) -> list[dict]:
    """Semantic search over the vault. Returns list of {file, heading, score, text}."""
    k = max(1, min(k, 20))
    vec = embed([query])[0]
    c = qdrant()
    results = c.query_points(collection_name=COLLECTION, query=vec, limit=k).points
    return [
        {
            "file": r.payload["file"],
            "heading": r.payload["heading"],
            "score": round(r.score, 4),
            "text": r.payload["text"],
        }
        for r in results
    ]


def related_notes(file: str) -> dict:
    """Return forward links and backlinks for a note."""
    index = file_index()
    target = Path(file)
    if target.suffix == ".md" and not target.is_absolute():
        path = VAULT / target
    else:
        stem = target.stem or str(target)
        if stem not in index:
            return {"error": f"note not found: {file}", "forward": [], "backlinks": []}
        path = index[stem]

    if not path.exists():
        return {"error": f"note not found: {file}", "forward": [], "backlinks": []}

    text = path.read_text(encoding="utf-8", errors="ignore")
    forward_stems = parse_links(text)
    forward = [
        {"stem": s, "path": str(index[s].relative_to(VAULT))}
        for s in forward_stems
        if s in index
    ]
    missing_forward = [s for s in forward_stems if s not in index]

    target_stem = path.stem
    backlinks = []
    for stem, p in index.items():
        if stem == target_stem:
            continue
        if target_stem in parse_links(p.read_text(encoding="utf-8", errors="ignore")):
            backlinks.append({"stem": stem, "path": str(p.relative_to(VAULT))})

    return {
        "file": str(path.relative_to(VAULT)),
        "forward": forward,
        "backlinks": backlinks,
        "missing_forward": missing_forward,
    }


def expand_search(query: str, k: int = 5) -> dict:
    """search_vault + wikilinks discovered in source files."""
    k = max(1, min(k, 10))
    hits = search_vault(query, k=k)
    index = file_index()
    expansions: list[dict] = []
    seen: set[str] = set()

    for h in hits:
        f = h["file"]
        if f in seen:
            continue
        seen.add(f)
        path = VAULT / f
        if not path.exists():
            continue
        links = parse_links(path.read_text(encoding="utf-8", errors="ignore"))
        resolved = [
            {"stem": s, "path": str(index[s].relative_to(VAULT))}
            for s in links
            if s in index
        ]
        if resolved:
            expansions.append({"from": f, "links": resolved})

    return {"hits": hits, "expansions": expansions}
