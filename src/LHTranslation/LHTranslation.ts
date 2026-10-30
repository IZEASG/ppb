import {
    Source,
    SourceInfo,
    TagSection,
    ContentRating,
    Response,
    Chapter,
    ChapterDetails,
    HomeSection,
    SearchRequest,
    PagedResults,
    SourceManga,
    SourceIntents
} from '@paperback/types'

const LH_DOMAIN = 'https://lhtranslation.net'

export const LHTranslationInfo: SourceInfo = {
    version: '1.0.0',
    name: 'LHTranslation',
    icon: 'icon.png',
    author: 'Inkdex',
    authorWebsite: 'https://github.com/inkdex',
    description: 'Extension that pulls content from lhtranslation.net',
    contentRating: ContentRating.EVERYONE,
    websiteBaseURL: LH_DOMAIN,
    sourceTags: [],
    intents: SourceIntents.MANGA_CHAPTERS | SourceIntents.HOMEPAGE_SECTIONS
}

export class LHTranslation extends Source {
    requestManager = App.createRequestManager({
        requestsPerSecond: 4,
        requestTimeout: 20000
    })

    override getMangaShareUrl(mangaId: string): string {
        return `${LH_DOMAIN}/manga/${mangaId}/`
    }

    async getMangaDetails(mangaId: string): Promise<SourceManga> {
        const request = App.createRequest({
            url: `${LH_DOMAIN}/manga/${mangaId}/`,
            method: 'GET'
        })

        const response = await this.requestManager.schedule(request, 1)
        const $ = this.cheerio.load(response.data as string)

        const title = $('div.post-title h1, div#manga-title h1').first().clone().children().remove().end().text().trim()
        const image = $('div.summary_image img').first().attr('data-src') || 
                      $('div.summary_image img').first().attr('src') || ''
        
        const author = $('div.author-content').first().text().replace('\\n', '').replace('Updating', '').trim()
        const artist = $('div.artist-content').first().text().replace('\\n', '').replace('Updating', '').trim()
        const description = $('div.description-summary, div.summary-container, div.manga-excerpt').first().text().replace('Show more', '').trim()
        
        const rating = (Number($('#averagerate').text().trim()) || 0) / 2
        const statusText = $('div.summary-content', $('div.post-content_item').last()).text().trim().toUpperCase()
        const status = statusText === 'COMPLETED' ? 'Completed' : 'Ongoing'

        const titles: string[] = [title]
        const altNames = $('h5:contains(Alternative), h5:contains(Alt Name(s))').parent().next().text().trim().split(/\s*[/,;]\s*/)
        for (const name of altNames) {
            if (name) titles.push(name.trim())
        }

        const tags: TagSection[] = []
        const genres: any[] = []
        for (const genre of $('div.genres-content a').toArray()) {
            const id = $(genre).attr('href')?.replace(/\/$/, '')?.split('/')?.pop() ?? ''
            const label = $(genre).text().trim()
            if (id && label) {
                genres.push({ id, label })
            }
        }
        tags.push(App.createTagSection({ id: 'genres', label: 'Genres', tags: genres.map(g => App.createTag(g)) }))

        return App.createSourceManga({
            id: mangaId,
            mangaInfo: App.createMangaInfo({
                titles,
                image: encodeURI(image.startsWith('//') ? `https:${image}` : image),
                rating,
                status,
                author,
                artist,
                desc: description,
                tags
            })
        })
    }

    async getChapters(mangaId: string): Promise<Chapter[]> {
        const request = App.createRequest({
            url: `${LH_DOMAIN}/manga/${mangaId}/ajax/chapters/`,
            method: 'POST',
            headers: {
                'content-type': 'application/x-www-form-urlencoded'
            }
        })

        let response: Response
        try {
            response = await this.requestManager.schedule(request, 1)
        } catch {
            const altReq = App.createRequest({
                url: `${LH_DOMAIN}/manga/${mangaId}/`,
                method: 'GET'
            })
            response = await this.requestManager.schedule(altReq, 1)
        }

        const $ = this.cheerio.load(response.data as string)
        const chapters: Chapter[] = []
        const chapterRows = $('li.wp-manga-chapter').toArray()

        for (const row of chapterRows) {
            const linkElem = $('a', row).first()
            const rawUrl = linkElem.attr('href') ?? ''
            const id = rawUrl.replace(/\/$/, '').split('/').pop() ?? ''
            const name = linkElem.text().trim()

            if (!id || id === '#') continue

            const match = id.match(/(?:chapter|ch.*?)(\d+\.?\d?(?:[-_]\d+)?)|(\d+\.?\d?(?:[-_]\d+)?)$/i)
            let chapNum = 0
            if (match) {
                const matchedStr = match[1] ? match[1].replace(/[-_]/gm, '.') : match[2]
                chapNum = parseFloat(matchedStr ?? '0') || 0
            }

            const dateStr = $('span.chapter-release-date i', row).text().trim()
            const time = dateStr ? new Date(dateStr) : new Date()

            chapters.push(App.createChapter({
                id,
                name: name || `Chapter ${chapNum}`,
                chapNum,
                time: isNaN(time.getTime()) ? new Date() : time,
                langCode: 'GB'
            }))
        }

        return chapters
    }

    async getChapterDetails(mangaId: string, chapterId: string): Promise<ChapterDetails> {
        const request = App.createRequest({
            url: `${LH_DOMAIN}/manga/${mangaId}/${chapterId}/?style=list`,
            method: 'GET',
            headers: {
                referer: `${LH_DOMAIN}/`
            }
        })

        const response = await this.requestManager.schedule(request, 1)
        const $ = this.cheerio.load(response.data as string)
        const pages: string[] = []

        $('div.page-break img').each((_: number, element: any) => {
            let img = $(element).attr('data-src') || 
                      $(element).attr('data-lazy-src') || 
                      $(element).attr('src') || ''
            
            img = img.trim()
            if (img.startsWith('//')) img = `https:${img}`
            if (img) pages.push(encodeURI(img))
        })

        return App.createChapterDetails({
            id: chapterId,
            mangaId,
            pages
        })
    }

    async getSearchResults(query: SearchRequest, metadata: any): Promise<PagedResults> {
        const page = metadata?.page ?? 1
        const searchTitle = encodeURIComponent(query.title ?? '')
        
        let url = `${LH_DOMAIN}/page/${page}/?s=${searchTitle}&post_type=wp-manga`
        if (query.includedTags && query.includedTags.length > 0) {
            for (let i = 0; i < query.includedTags.length; i++) {
                url += `&genre[${i}]=${query.includedTags[i]?.id}`
            }
            url += '&op=1'
        }

        const request = App.createRequest({
            url,
            method: 'GET'
        })

        const response = await this.requestManager.schedule(request, 1)
        const $ = this.cheerio.load(response.data as string)
        const tiles: any[] = []

        for (const item of $('div.c-tabs-item__content').toArray()) {
            const link = $('a', item).first()
            const href = link.attr('href') ?? ''
            const id = href.replace(/\/$/, '').split('/').pop() ?? ''
            const title = link.attr('title') || $('h3 a', item).text().trim() || ''
            
            let image = $('img', item).attr('data-src') || 
                        $('img', item).attr('data-lazy-src') || 
                        $('img', item).attr('src') || ''
            
            if (image.startsWith('//')) image = `https:${image}`

            const latestChapter = $('span.font-meta.chapter', item).first().text().trim()

            if (id && title) {
                tiles.push(App.createPartialSourceManga({
                    mangaId: id,
                    title,
                    image: encodeURI(image),
                    subtitle: latestChapter
                }))
            }
        }

        const hasNextPage = $('a.next.page-numbers').length > 0
        return App.createPagedResults({
            results: tiles,
            metadata: hasNextPage ? { page: page + 1 } : undefined
        })
    }

    override async getHomePageSections(sectionCallback: (section: HomeSection) => void): Promise<void> {
        const sections = [
            App.createHomeSection({ id: 'latest', title: 'Recently Updated', containsMoreItems: true, type: 'single_row_normal' }),
            App.createHomeSection({ id: 'trending', title: 'Currently Trending', containsMoreItems: true, type: 'single_row_normal' }),
            App.createHomeSection({ id: 'views', title: 'Most Popular', containsMoreItems: true, type: 'single_row_normal' })
        ]

        for (const section of sections) {
            sectionCallback(section)
            const orderParam = section.id === 'latest' ? 'latest' : (section.id === 'trending' ? 'trending' : 'views')
            const request = App.createRequest({
                url: `${LH_DOMAIN}/manga/?m_orderby=${orderParam}`,
                method: 'GET'
            })

            const response = await this.requestManager.schedule(request, 1)
            const $ = this.cheerio.load(response.data as string)
            const items: any[] = []

            for (const item of $('div.page-item-detail').toArray()) {
                const link = $('a', $('h3.h5', item)).last()
                const title = link.text().trim()
                const href = link.attr('href') ?? ''
                const id = href.replace(/\/$/, '').split('/').pop() ?? ''
                
                let image = $('img', item).attr('data-src') || 
                            $('img', item).attr('data-lazy-src') || 
                            $('img', item).attr('src') || ''
                if (image.startsWith('//')) image = `https:${image}`

                const subtitle = $('span.font-meta.chapter', item).first().text().trim()

                if (id && title) {
                    items.push(App.createPartialSourceManga({
                        mangaId: id,
                        title,
                        image: encodeURI(image),
                        subtitle
                    }))
                }
            }

            section.items = items
            sectionCallback(section)
        }
    }

    override async getViewMoreItems(homepageSectionId: string, metadata: any): Promise<PagedResults> {
        const page = metadata?.page ?? 1
        const orderParam = homepageSectionId === 'latest' ? 'latest' : (homepageSectionId === 'trending' ? 'trending' : 'views')
        
        const request = App.createRequest({
            url: `${LH_DOMAIN}/manga/page/${page}/?m_orderby=${orderParam}`,
            method: 'GET'
        })

        const response = await this.requestManager.schedule(request, 1)
        const $ = this.cheerio.load(response.data as string)
        const items: any[] = []

        for (const item of $('div.page-item-detail').toArray()) {
            const link = $('a', $('h3.h5', item)).last()
            const title = link.text().trim()
            const href = link.attr('href') ?? ''
            const id = href.replace(/\/$/, '').split('/').pop() ?? ''

            let image = $('img', item).attr('data-src') || 
                        $('img', item).attr('data-lazy-src') || 
                        $('img', item).attr('src') || ''
            if (image.startsWith('//')) image = `https:${image}`

            const subtitle = $('span.font-meta.chapter', item).first().text().trim()

            if (id && title) {
                items.push(App.createPartialSourceManga({
                    mangaId: id,
                    title,
                    image: encodeURI(image),
                    subtitle
                }))
            }
        }

        const hasNextPage = $('a.next.page-numbers').length > 0
        return App.createPagedResults({
            results: items,
            metadata: hasNextPage ? { page: page + 1 } : undefined
        })
    }
}
