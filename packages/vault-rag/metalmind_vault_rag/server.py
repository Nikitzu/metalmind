from mcp.server.fastmcp import FastMCP

from . import search

mcp = FastMCP("vault-rag")


@mcp.tool()
def search_vault(query: str, k: int = 5) -> list[dict]:
    """Semantic search over the Obsidian Knowledge vault."""
    return search.search_vault(query, k)


@mcp.tool()
def related_notes(file: str) -> dict:
    """Return forward links and backlinks for a note."""
    return search.related_notes(file)


@mcp.tool()
def expand_search(query: str, k: int = 5) -> dict:
    """search_vault + wikilinks discovered in source files."""
    return search.expand_search(query, k)


def main() -> None:
    mcp.run()


if __name__ == "__main__":
    main()
