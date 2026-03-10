from contextlib import asynccontextmanager

import uvicorn
from crawl4ai import AsyncWebCrawler, BrowserConfig, CrawlerRunConfig, CacheMode
from fastapi import FastAPI
from pydantic import BaseModel


class CrawlerConfigRequest(BaseModel):
    exclude_external_links: bool = True
    remove_overlay_elements: bool = True
    word_count_threshold: int = 10


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
    uvicorn.run(app, host="0.0.0.0", port=11235)
