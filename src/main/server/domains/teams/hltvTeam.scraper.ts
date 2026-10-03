// src/main/server/domains/teams/hltvTeam.scraper.ts
import { BrowserWindow } from 'electron'
import { execFile } from 'child_process'
import { downloadImageFromUrl } from '../../utils/downloadImage'
import { resolveCountryCode } from '../../utils/countries'

export interface HltvScrapedTeam {
  name: string
  shortName: string
  country: string
  countryName: string
  logo: string
  logoUrl: string
}

function decodeHtml(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
}

function parseTeamHtml(html: string) {
  if (
    html &&
    html.includes('404') &&
    (html.includes('Page not found') || html.includes('not found') || html.includes('Page does not exist'))
  ) {
    throw new Error('This team does not exist on HLTV (404 Not Found). Please verify the URL.')
  }

  if (
    !html ||
    html.includes('challenge-platform') ||
    html.includes('Just a moment') ||
    html.includes('cf_chl_') ||
    !html.includes('profile-team-name')
  ) {
    return null
  }

  // Team name and short name: /html/body/div[3]/div[6]/div[2]/div[1]/div[2]/div[2]/div[1]/div[1]/div[2]/h1
  const nameMatch =
    html.match(/<h1[^>]*class="[^"]*profile-team-name[^"]*"[^>]*>([\s\S]*?)<\/h1>/i) ||
    html.match(/<div[^>]*class="[^"]*profile-team-info[^"]*"[\s\S]*?<h1[^>]*>([\s\S]*?)<\/h1>/i)

  const rawName = nameMatch ? decodeHtml(nameMatch[1].trim()) : ''
  const lowerName = rawName.toLowerCase()
  if (
    !rawName ||
    lowerName.includes('hltv.org') ||
    lowerName.includes('cloudflare') ||
    lowerName.includes('just a moment') ||
    lowerName.includes('attention required')
  ) {
    return null
  }

  // Logo: /html/body/div[3]/div[6]/div[2]/div[1]/div[2]/div[2]/div[1]/div[1]/div[1]/img[2]
  // In the logo container, img[2] is typically the second img (night-only or primary logo)
  let logoUrl = ''
  const logoContainerMatch = html.match(
    /<div[^>]*class="[^"]*(?:profile-team-logo-container|teamlogo-container)[^"]*"[\s\S]*?<\/div>/i
  )
  if (logoContainerMatch) {
    const imgTags = logoContainerMatch[0].match(/<img[^>]+>/gi) || []
    // Prefer the second img tag as requested (img[2]), fall back to first
    const targetTag = imgTags[1] || imgTags[0]
    if (targetTag) {
      const srcMatch = targetTag.match(/\ssrc="([^"]+)"/i)
      if (srcMatch && srcMatch[1]) {
        logoUrl = decodeHtml(srcMatch[1].trim())
      }
    }
  }

  if (!logoUrl) {
    const fallbackImg = html.match(/<img[^>]+class="[^"]*teamlogo[^"]*"[^>]*src="([^"]+)"/i)
    if (fallbackImg && fallbackImg[1]) {
      logoUrl = decodeHtml(fallbackImg[1].trim())
    } else {
      const ogMatch = html.match(/<meta[^>]*property="og:image"[^>]*content="([^"]+)"/i)
      if (ogMatch && ogMatch[1]) {
        logoUrl = decodeHtml(ogMatch[1].trim())
      }
    }
  }

  // Remove any bg parameter if present so logo remains transparent
  if (logoUrl) {
    try {
      const u = new URL(logoUrl)
      if (u.searchParams.has('bg')) {
        u.searchParams.delete('bg')
      }
      logoUrl = u.toString()
    } catch {
      logoUrl = logoUrl.replace(/([?&])bg=[^&]+(&|$)/, (_, p1, p2) => (p2 === '&' ? p1 : ''))
    }
  }

  // Country: /html/body/div[3]/div[6]/div[2]/div[1]/div[2]/div[2]/div[1]/div[1]/div[2]/div/img
  const countrySection =
    html.match(/<div[^>]*class="[^"]*team-country[^"]*"[\s\S]*?<img[^>]*>/i) ||
    html.match(/<div[^>]*class="[^"]*profile-team-info[^"]*"[\s\S]*?<img[^>]*class="[^"]*flag[^"]*"[^>]*>/i) ||
    html.match(/<img[^>]*class="[^"]*flag[^"]*"[^>]*>/i)

  const flagImg = countrySection ? countrySection[0] : ''
  const countryTitle = (flagImg.match(/title="([^"]+)"/i) || [])[1] || ''
  const countryAlt = (flagImg.match(/alt="([^"]+)"/i) || [])[1] || ''
  const countrySrc = (flagImg.match(/src="([^"]+)"/i) || [])[1] || ''

  return {
    name: rawName,
    shortName: rawName,
    countryTitle: decodeHtml(countryTitle || countryAlt),
    countrySrc,
    logoUrl
  }
}

async function fetchViaCurl(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'curl.exe',
      [
        '-s',
        '-L',
        '--max-time',
        '10',
        '-A',
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
        '-H',
        'Accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        '-H',
        'Accept-Language: en-US,en;q=0.9',
        url
      ],
      { maxBuffer: 15 * 1024 * 1024 },
      (error, stdout) => {
        if (error) return reject(error)
        resolve(stdout)
      }
    )
  })
}

async function fetchViaBrowserWindow(url: string): Promise<{
  name: string
  shortName: string
  countryTitle: string
  countrySrc: string
  logoUrl: string
}> {
  return new Promise((resolve, reject) => {
    let win: BrowserWindow | null = new BrowserWindow({
      show: false,
      width: 1280,
      height: 900,
      webPreferences: {
        offscreen: false,
        nodeIntegration: false,
        contextIsolation: true,
        backgroundThrottling: false
      }
    })

    let isDone = false
    let pollInterval: NodeJS.Timeout | null = null
    let elapsedMs = 0

    const cleanup = () => {
      if (pollInterval) {
        clearInterval(pollInterval)
        pollInterval = null
      }
      if (timeoutId) clearTimeout(timeoutId)
      if (win && !win.isDestroyed()) {
        try {
          win.destroy()
        } catch {
          /* ignore */
        }
      }
      win = null
    }

    const timeoutId = setTimeout(() => {
      if (isDone) return
      isDone = true
      cleanup()
      reject(new Error('HLTV request timed out. Please check the URL and try again.'))
    }, 15000)

    win.webContents.on('did-fail-load', (_event, errorCode, errorDescription, _validatedURL, isMainFrame) => {
      if (isDone || !isMainFrame || errorCode === -3) return
      isDone = true
      cleanup()
      reject(new Error(`Failed to load HLTV team page: ${errorDescription} (${errorCode})`))
    })

    win.webContents.on('did-navigate', (_event, _url, httpResponseCode) => {
      if (httpResponseCode === 404 || httpResponseCode === 410) {
        if (isDone) return
        isDone = true
        cleanup()
        reject(new Error('This team does not exist on HLTV (404 Not Found). Please verify the URL.'))
      }
    })

    const checkPage = async () => {
      if (isDone || !win || win.isDestroyed()) return
      elapsedMs += 1000

      try {
        const title = (win.webContents.getTitle() || '').toLowerCase()
        if (
          title.includes('just a moment') ||
          title.includes('attention required') ||
          title.includes('cloudflare') ||
          title.includes('challenge') ||
          title === 'www.hltv.org'
        ) {
          return // Still on Cloudflare challenge screen
        }

        if (title.includes('404') || title.includes('not found') || title.includes('page not found')) {
          if (isDone) return
          isDone = true
          cleanup()
          reject(new Error('This team does not exist on HLTV (404 Not Found). Please verify the URL.'))
          return
        }

        const extracted = await win.webContents.executeJavaScript(`
          (() => {
            const bodyText = (document.body ? document.body.innerText : '').toLowerCase();
            if (
              bodyText.includes('page not found') ||
              bodyText.includes('page does not exist') ||
              bodyText.includes('404 - not found') ||
              bodyText.includes('error 404') ||
              (bodyText.includes('404') && bodyText.includes('not found'))
            ) {
              return { notFound: true };
            }

            function getByXPath(xpath) {
              try {
                const res = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
                return res.singleNodeValue;
              } catch (e) {
                return null;
              }
            }

            // User xpath: /html/body/div[3]/div[6]/div[2]/div[1]/div[2]/div[2]/div[1]/div[1]/div[2]/h1
            const nameEl =
              getByXPath('/html/body/div[3]/div[6]/div[2]/div[1]/div[2]/div[2]/div[1]/div[1]/div[2]/h1') ||
              document.querySelector('h1.profile-team-name') ||
              document.querySelector('.profile-team-name') ||
              document.querySelector('.profile-team-info h1');

            if (!nameEl) return null;

            const name = (nameEl.textContent || '').trim();
            const lower = name.toLowerCase();

            // Strictly reject Cloudflare / domain fallback strings
            if (
              !name ||
              lower.includes('hltv.org') ||
              lower.includes('cloudflare') ||
              lower.includes('just a moment') ||
              lower.includes('attention required') ||
              lower.includes('turnstile')
            ) {
              return null;
            }

            // User xpath: /html/body/div[3]/div[6]/div[2]/div[1]/div[2]/div[2]/div[1]/div[1]/div[1]/img[2]
            const logoEl =
              getByXPath('/html/body/div[3]/div[6]/div[2]/div[1]/div[2]/div[2]/div[1]/div[1]/div[1]/img[2]') ||
              getByXPath('/html/body/div[3]/div[6]/div[2]/div[1]/div[2]/div[2]/div[1]/div[1]/div[1]/img') ||
              document.querySelector('.profile-team-logo-container img:nth-of-type(2)') ||
              document.querySelector('.profile-team-logo-container img') ||
              document.querySelector('img.teamlogo') ||
              document.querySelector('.teamlogo');

            let logoUrl = '';
            if (logoEl) {
              logoUrl = logoEl.getAttribute('src') || logoEl.src || '';
            }
            if (!logoUrl) {
              const metaOg = document.querySelector('meta[property="og:image"]');
              if (metaOg) {
                logoUrl = metaOg.getAttribute('content') || '';
              }
            }

            // User xpath: /html/body/div[3]/div[6]/div[2]/div[1]/div[2]/div[2]/div[1]/div[1]/div[2]/div/img
            const countryEl =
              getByXPath('/html/body/div[3]/div[6]/div[2]/div[1]/div[2]/div[2]/div[1]/div[1]/div[2]/div/img') ||
              document.querySelector('.team-country img.flag') ||
              document.querySelector('.profile-team-info img.flag') ||
              document.querySelector('.profile-team-info img') ||
              document.querySelector('img.flag');

            const countryTitle = countryEl
              ? (countryEl.getAttribute('title') || countryEl.getAttribute('alt') || '')
              : '';
            const countrySrc = countryEl
              ? (countryEl.getAttribute('src') || countryEl.src || '')
              : '';

            return {
              name,
              shortName: name,
              logoUrl,
              countryTitle,
              countrySrc
            };
          })()
        `)

        if (extracted && (extracted as any).notFound) {
          if (isDone) return
          isDone = true
          cleanup()
          reject(new Error('This team does not exist on HLTV (404 Not Found). Please verify the URL.'))
          return
        }

        if (extracted && extracted.name) {
          isDone = true
          cleanup()
          resolve(extracted)
        }
      } catch {
        /* continue polling */
      }
    }

    win.webContents.on('did-finish-load', () => {
      checkPage()
    })

    pollInterval = setInterval(checkPage, 1000)

    win.loadURL(url).catch((err) => {
      if (isDone) return
      isDone = true
      cleanup()
      reject(new Error(`Could not connect to HLTV: ${err.message}`))
    })
  })
}

export async function scrapeHltvTeam(rawUrl: string): Promise<HltvScrapedTeam> {
  let targetUrl = rawUrl.trim()
  if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
    targetUrl = 'https://' + targetUrl
  }

  let parsed: URL
  try {
    parsed = new URL(targetUrl)
  } catch {
    throw new Error('Please enter a valid URL')
  }

  if (!parsed.hostname.includes('hltv.org') || !parsed.pathname.includes('/team/')) {
    throw new Error('Please enter a valid HLTV team profile URL (e.g. https://www.hltv.org/team/9565/vitality)')
  }

  let extractedData: {
    name: string
    shortName: string
    countryTitle: string
    countrySrc: string
    logoUrl: string
  } | null = null

  // 1. Try fast curl fetch
  try {
    const html = await fetchViaCurl(targetUrl)
    const parsed = parseTeamHtml(html)
    if (parsed && parsed.name) {
      extractedData = parsed
    }
  } catch (err) {
    console.warn('[HLTV Team Scraper] Direct curl fetch failed, falling back to BrowserWindow:', err)
  }

  // 2. Fallback to BrowserWindow
  if (!extractedData || !extractedData.name) {
    try {
      extractedData = await fetchViaBrowserWindow(targetUrl)
    } catch (err: any) {
      throw new Error(`Failed to fetch HLTV team profile: ${err.message}`)
    }
  }

  if (!extractedData || !extractedData.name) {
    throw new Error('Could not extract team information from the provided HLTV URL. Please verify the profile link.')
  }

  const countryCode = resolveCountryCode(extractedData.countryTitle, extractedData.countrySrc)

  let fullLogoUrl = extractedData.logoUrl
  if (fullLogoUrl) {
    if (fullLogoUrl.startsWith('//')) {
      fullLogoUrl = 'https:' + fullLogoUrl
    } else if (fullLogoUrl.startsWith('/')) {
      fullLogoUrl = 'https://www.hltv.org' + fullLogoUrl
    }

    try {
      const u = new URL(fullLogoUrl)
      if (u.searchParams.has('bg')) {
        u.searchParams.delete('bg')
      }
      fullLogoUrl = u.toString()
    } catch {
      fullLogoUrl = fullLogoUrl.replace(/([?&])bg=[^&]+(&|$)/, (_, p1, p2) => (p2 === '&' ? p1 : ''))
    }
  }

  let localLogoPath = ''
  if (fullLogoUrl) {
    try {
      localLogoPath = await downloadImageFromUrl(fullLogoUrl)
    } catch (err: any) {
      console.warn('[HLTV Team Scraper] Failed to download logo locally, using remote URL:', err.message)
      localLogoPath = fullLogoUrl
    }
  }

  return {
    name: extractedData.name,
    shortName: extractedData.shortName || extractedData.name,
    country: countryCode,
    countryName: extractedData.countryTitle,
    logo: localLogoPath,
    logoUrl: fullLogoUrl
  }
}
