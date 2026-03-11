import json
from contextlib import asynccontextmanager
from pathlib import Path

import uvicorn
from crawl4ai import AsyncWebCrawler, BrowserConfig, CrawlerRunConfig, CacheMode
from fastapi import FastAPI
from pydantic import BaseModel

_config_path = Path(__file__).parent.parent / "webchat.config.json"
_app_config = json.loads(_config_path.read_text(encoding="utf-8"))
_crawl_config = _app_config.get("crawlService", {})
_crawl4ai_defaults = _app_config.get("extension", {}).get("crawl4ai", {})


class CrawlerConfigRequest(BaseModel):
    exclude_external_links: bool = _crawl4ai_defaults.get("excludeExternalLinks")
    remove_overlay_elements: bool = _crawl4ai_defaults.get("removeOverlayElements")
    word_count_threshold: int = _crawl4ai_defaults.get("wordCountThreshold")


class ExtractRequest(BaseModel):
    urls: list[str]
    crawler_config: CrawlerConfigRequest = CrawlerConfigRequest()


crawler: AsyncWebCrawler | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global crawler
    browser_conf = BrowserConfig(headless=True)
    crawler = AsyncWebCrawler(config=browser_conf)
    await crawler.__aenter__()
    yield
    await crawler.__aexit__(None, None, None)
    crawler = None


app = FastAPI(lifespan=lifespan)


@app.post("/extract")
async def extract(request: ExtractRequest):
    run_conf = CrawlerRunConfig(
        cache_mode=CacheMode.BYPASS,
        exclude_external_links=request.crawler_config.exclude_external_links,
        remove_overlay_elements=request.crawler_config.remove_overlay_elements,
        word_count_threshold=request.crawler_config.word_count_threshold,
    )

    results = []
    for url in request.urls:
        result = await crawler.arun(url=url, config=run_conf)
        results.append({
            "markdown": {
                "raw_markdown": result.markdown.raw_markdown if result.success else "",
            },
            "success": result.success,
            "url": url,
        })

    return {"results": results}


if __name__ == "__main__":
    uvicorn.run(app, host=_crawl_config.get("host"), port=_crawl_config.get("port"))
