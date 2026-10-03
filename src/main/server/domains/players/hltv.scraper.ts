// src/main/server/domains/players/hltv.scraper.ts
import { BrowserWindow } from 'electron'
import { execFile } from 'child_process'
import https from 'https'
import zlib from 'zlib'
import { downloadImageFromUrl } from '../../utils/downloadImage'
import { resolveCountryCode } from '../../utils/countries'

export interface HltvScrapedPlayer {
  username: string
  firstName: string
  lastName: string
  country: string
  countryName: string
  team: string
  avatar: string
  avatarUrl: string
  steamid: string
}

export interface RawScrapedPlayerData {
  username: string
  firstName: string
  lastName: string
  countryTitle: string
  countrySrc: string
  team: string
  avatarUrl: string
}

function decodeHtml(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
}

function parsePlayerHtml(html: string): RawScrapedPlayerData | null {
  if (
    !html ||
    html.includes('challenge-platform') ||
    html.includes('Just a moment') ||
    html.includes('cf_chl_') ||
    !html.includes('playerNickname')
  ) {
    return null
  }

  const unameMatch = html.match(/<h1[^>]*class="[^"]*playerNickname[^"]*"[^>]*>([\s\S]*?)<\/h1>/i)
  const realNameMatch = html.match(/<div[^>]*class="[^"]*playerRealname[^"]*"[^>]*>([\s\S]*?)<\/div>/i)
  const flagMatch = html.match(/<div[^>]*class="[^"]*player-summary-stat-box-left-flag[^"]*"[\s\S]*?<img[^>]*>/i)
  const flagImg = flagMatch ? flagMatch[0] : ''
  const countryTitle = (flagImg.match(/title="([^"]+)"/i) || [])[1] || ''
  const countryAlt = (flagImg.match(/alt="([^"]+)"/i) || [])[1] || ''
  const countrySrc = (flagImg.match(/src="([^"]+)"/i) || [])[1] || ''

  // Team extraction: only inspect the Team row in player profile
  let team = ''
  const teamRowMatch =
    html.match(/<span[^>]*>\s*Team\s*<\/span>[\s\S]*?<span[^>]*class="[^"]*listRight[^"]*"[^>]*>([\s\S]*?)<\/span>/i) ||
    html.match(/<div[^>]*class="[^"]*playerTeam[^"]*"[^>]*>([\s\S]*?)<\/div>/i)

  if (teamRowMatch && teamRowMatch[1]) {
    const teamContent = teamRowMatch[1]
    const linkMatch =
      teamContent.match(/<a[^>]*href="\/team\/[^"]*"[^>]*>([\s\S]*?)<\/a>/i) ||
      teamContent.match(/<a[^>]*>([\s\S]*?)<\/a>/i)
    if (linkMatch && linkMatch[1]) {
      team = decodeHtml(linkMatch[1].replace(/<[^>]+>/g, '').trim())
    } else {
      team = decodeHtml(teamContent.replace(/<[^>]+>/g, '').trim())
    }
  }

  const cleanLower = team.toLowerCase().trim()
  if (
    !team ||
    cleanLower === '-' ||
    cleanLower === 'n/a' ||
    cleanLower === 'none' ||
    cleanLower === 'no team' ||
    cleanLower.includes('no team')
  ) {
    team = ''
  }

  // Extract transparent avatar image from bodyshot wrapper
  const wrapperMatch = html.match(
    /<div[^>]*class="[^"]*player-summary-stat-box-left-bodyshot-wrapper[^"]*"[\s\S]*?(<img[^>]+>)[\s\S]*?<\/div>/i
  )
  const imgTag = wrapperMatch
    ? wrapperMatch[1]
    : (html.match(/<img[^>]+class="[^"]*bodyshot[^"]*"[^>]*>/i) ||
       html.match(/<img[^>]+bodyshot[^>]*>/i) ||
       [])[0]

  let avatarUrl = ''
  if (imgTag) {
    const srcMatch = imgTag.match(/\ssrc="([^"]+)"/i)
    if (srcMatch && srcMatch[1]) {
      avatarUrl = decodeHtml(srcMatch[1].trim())
    }
  }

  const rawUsername = unameMatch ? decodeHtml(unameMatch[1].trim()) : ''
  if (!rawUsername || rawUsername.toLowerCase().includes('hltv.org')) {
    return null
  }

  const fullName = realNameMatch ? decodeHtml(realNameMatch[1].trim()) : ''
  const words = fullName ? fullName.split(/\s+/).filter(Boolean) : []
  const firstName = words[0] || ''
  const lastName = words.slice(1).join(' ') || ''

  return {
    username: rawUsername,
    firstName,
    lastName,
    countryTitle: decodeHtml(countryTitle || countryAlt),
    countrySrc,
    team,
    avatarUrl
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

async function fetchViaBrowserWindow(url: string): Promise<RawScrapedPlayerData> {
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
    }, 30000)

    win.webContents.on('did-fail-load', (_event, errorCode, errorDescription, _validatedURL, isMainFrame) => {
      if (isDone || !isMainFrame || errorCode === -3) return
      isDone = true
      cleanup()
      reject(new Error(`Failed to load HLTV player page: ${errorDescription} (${errorCode})`))
    })

    const checkPage = async () => {
      if (isDone || !win || win.isDestroyed()) return
      elapsedMs += 1000

      if (elapsedMs >= 4000 && win && !win.isVisible()) {
        try {
          win.show()
          win.focus()
        } catch {
          /* ignore */
        }
      }

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

        const extracted = await win.webContents.executeJavaScript(`
          (() => {
            function getByXPath(xpath) {
              try {
                const res = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
                return res.singleNodeValue;
              } catch (e) {
                return null;
              }
            }

            // 1. Username: /html/body/div[3]/div[6]/div[2]/div[1]/div[2]/div[1]/div[3]/div[1]/div[1]/h1
            const usernameEl =
              getByXPath('/html/body/div[3]/div[6]/div[2]/div[1]/div[2]/div[1]/div[3]/div[1]/div[1]/h1') ||
              document.querySelector('h1.playerNickname') ||
              document.querySelector('.playerNickname');

            if (!usernameEl) return null;

            const username = (usernameEl.textContent || '').trim();
            const lowerUser = username.toLowerCase();
            if (
              !username ||
              lowerUser.includes('hltv.org') ||
              lowerUser.includes('cloudflare') ||
              lowerUser.includes('just a moment') ||
              lowerUser.includes('attention required') ||
              lowerUser.includes('turnstile')
            ) {
              return null;
            }

            // 2. Real name: /html/body/div[3]/div[6]/div[2]/div[1]/div[2]/div[1]/div[3]/div[1]/div[1]/div
            const nameEl =
              getByXPath('/html/body/div[3]/div[6]/div[2]/div[1]/div[2]/div[1]/div[3]/div[1]/div[1]/div') ||
              document.querySelector('.playerRealname') ||
              document.querySelector('.player-realname');

            const fullName = nameEl ? (nameEl.textContent || '').trim() : '';
            const words = fullName ? fullName.split(/\\s+/).filter(Boolean) : [];
            const firstName = words[0] || '';
            const lastName = words.slice(1).join(' ') || '';

            // 3. Country: /html/body/div[3]/div[6]/div[2]/div[1]/div[2]/div[1]/div[2]/div[1]/div/img
            const countryEl =
              getByXPath('/html/body/div[3]/div[6]/div[2]/div[1]/div[2]/div[1]/div[2]/div[1]/div/img') ||
              document.querySelector('.player-summary-stat-box-left-flag img') ||
              document.querySelector('.player-summary-stat-box-left-flag') ||
              document.querySelector('img.flag');

            const countryTitle = countryEl
              ? (countryEl.getAttribute('title') || countryEl.getAttribute('alt') || '')
              : '';
            const countrySrc = countryEl
              ? (countryEl.getAttribute('src') || countryEl.src || '')
              : '';

            // 4. Team:
            // Check the exact container: /html/body/div[3]/div[6]/div[2]/div[1]/div[2]/div[1]/div[3]/div[2]/div[2]/span[2]/span
            const teamContainer =
              getByXPath('/html/body/div[3]/div[6]/div[2]/div[1]/div[2]/div[1]/div[3]/div[2]/div[2]/span[2]/span') ||
              getByXPath('/html/body/div[3]/div[6]/div[2]/div[1]/div[2]/div[1]/div[3]/div[2]/div[2]/span[2]') ||
              getByXPath('/html/body/div[3]/div[6]/div[2]/div[1]/div[2]/div[1]/div[3]/div[2]/div[2]') ||
              document.querySelector('.playerTeam') ||
              document.querySelector('.player-team');

            let team = '';
            if (teamContainer) {
              const link = teamContainer.querySelector('a[href*="/team/"]') || teamContainer.querySelector('a');
              if (link) {
                team = (link.textContent || '').trim();
              } else {
                team = (teamContainer.textContent || '').trim();
              }
            }

            if (!team) {
              // Try finding the row specifically labeled "Team"
              const allSpans = Array.from(document.querySelectorAll('span, div'));
              const teamLabel = allSpans.find(
                s => s.children.length === 0 && s.textContent.trim().toLowerCase() === 'team'
              );
              if (teamLabel && teamLabel.parentElement) {
                const rightSide = teamLabel.parentElement.querySelector('.listRight, span:last-child');
                if (rightSide) {
                  const link = rightSide.querySelector('a');
                  team = link ? (link.textContent || '').trim() : (rightSide.textContent || '').trim();
                }
              }
            }

            const cleanLower = team.toLowerCase().trim();
            if (
              !team ||
              cleanLower === '-' ||
              cleanLower === 'n/a' ||
              cleanLower === 'none' ||
              cleanLower === 'no team' ||
              cleanLower.includes('no team')
            ) {
              team = '';
            }

            // 5. Avatar: /html/body/div[3]/div[6]/div[2]/div[1]/div[2]/div[1]/div[2]/div[2]/img
            const avatarEl =
              getByXPath('/html/body/div[3]/div[6]/div[2]/div[1]/div[2]/div[1]/div[2]/div[2]/img') ||
              document.querySelector('.player-summary-stat-box-left-bodyshot-wrapper img') ||
              document.querySelector('img.bodyshot') ||
              document.querySelector('.bodyshot');

            let avatarUrl = '';
            if (avatarEl) {
              avatarUrl = avatarEl.getAttribute('src') || avatarEl.src || '';
            }

            return {
              username,
              firstName,
              lastName,
              countryTitle,
              countrySrc,
              team,
              avatarUrl
            };
          })()
        `)

        if (extracted && extracted.username) {
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

export async function scrapeHltvPlayer(rawUrl: string): Promise<HltvScrapedPlayer> {
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

  if (!parsed.hostname.includes('hltv.org') || !parsed.pathname.includes('/player/')) {
    throw new Error('Please enter a valid HLTV player profile URL (e.g. https://www.hltv.org/player/11816/ropz)')
  }

  let extractedData: RawScrapedPlayerData | null = null

  // 1. Try fast curl fetch
  try {
    const html = await fetchViaCurl(targetUrl)
    const parsed = parsePlayerHtml(html)
    if (parsed && parsed.username) {
      extractedData = parsed
    }
  } catch (err) {
    console.warn('[HLTV Scraper] Direct curl fetch failed, falling back to BrowserWindow:', err)
  }

  // 2. Fallback to BrowserWindow
  if (!extractedData || !extractedData.username) {
    try {
      extractedData = await fetchViaBrowserWindow(targetUrl)
    } catch (err: any) {
      throw new Error(`Failed to fetch HLTV player profile: ${err.message}`)
    }
  }

  if (!extractedData || !extractedData.username) {
    throw new Error('Could not extract player information from the provided HLTV URL. Please verify the profile link.')
  }

  const countryCode = resolveCountryCode(extractedData.countryTitle, extractedData.countrySrc)

  let fullAvatarUrl = extractedData.avatarUrl
  if (fullAvatarUrl) {
    if (fullAvatarUrl.startsWith('//')) {
      fullAvatarUrl = 'https:' + fullAvatarUrl
    } else if (fullAvatarUrl.startsWith('/')) {
      fullAvatarUrl = 'https://www.hltv.org' + fullAvatarUrl
    }

    try {
      const u = new URL(fullAvatarUrl)
      if (u.searchParams.has('bg')) {
        u.searchParams.delete('bg')
      }
      fullAvatarUrl = u.toString()
    } catch {
      fullAvatarUrl = fullAvatarUrl.replace(/([?&])bg=[^&]+(&|$)/, (_, p1, p2) => (p2 === '&' ? p1 : ''))
    }
  }

  let localAvatarPath = ''
  if (fullAvatarUrl) {
    try {
      localAvatarPath = await downloadImageFromUrl(fullAvatarUrl)
    } catch (err: any) {
      console.warn('[HLTV Scraper] Failed to download avatar locally, using remote URL:', err.message)
      localAvatarPath = fullAvatarUrl
    }
  }

  // Resolve Steam ID via Liquipedia and Steam XML API
  let steamid = ''
  try {
    steamid = await resolveSteamIdFromLiquipedia(extractedData.username)
  } catch (err: any) {
    console.warn('[HLTV Scraper] Failed to resolve Steam ID from Liquipedia:', err.message)
  }

  return {
    username: extractedData.username,
    firstName: extractedData.firstName,
    lastName: extractedData.lastName,
    country: countryCode,
    countryName: extractedData.countryTitle,
    team: extractedData.team,
    avatar: localAvatarPath,
    avatarUrl: fullAvatarUrl,
    steamid
  }
}

function fetchLiquipediaApi(queryString: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const url = `https://liquipedia.net/counterstrike/api.php?${queryString}`
    const req = https.get(
      url,
      {
        headers: {
          'User-Agent': 'JTsHud/1.0 (contact@jtshud.local)',
          'Accept-Encoding': 'gzip'
        }
      },
      (res) => {
        let stream: NodeJS.ReadableStream = res
        if (res.headers['content-encoding'] === 'gzip') {
          stream = res.pipe(zlib.createGunzip())
        }
        let data = ''
        stream.on('data', (chunk) => {
          data += chunk
        })
        stream.on('end', () => {
          try {
            resolve(JSON.parse(data))
          } catch {
            resolve(null)
          }
        })
        stream.on('error', reject)
      }
    )
    req.on('error', reject)
    req.setTimeout(8000, () => {
      req.destroy(new Error('Liquipedia API request timed out'))
    })
  })
}

function fetchSteamXml(steamUrl: string): Promise<string> {
  return new Promise((resolve) => {
    const cleanUrl = steamUrl.replace(/[?#].*$/, '').replace(/\/+$/, '')
    const targetUrl = `${cleanUrl}/?xml=1`

    execFile(
      'curl.exe',
      [
        '-s',
        '-L',
        '--max-time',
        '8',
        '-A',
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
        targetUrl
      ],
      { maxBuffer: 5 * 1024 * 1024 },
      (error, stdout) => {
        if (!error && stdout) {
          resolve(stdout)
        } else {
          try {
            const req = https.get(
              targetUrl,
              {
                headers: {
                  'User-Agent':
                    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36'
                }
              },
              (res) => {
                let body = ''
                res.on('data', (chunk) => (body += chunk))
                res.on('end', () => resolve(body))
                res.on('error', () => resolve(''))
              }
            )
            req.on('error', () => resolve(''))
            req.setTimeout(5000, () => {
              req.destroy()
              resolve('')
            })
          } catch {
            resolve('')
          }
        }
      }
    )
  })
}

async function fetchLiquipediaSteamViaBrowserWindow(username: string): Promise<string> {
  return new Promise((resolve) => {
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
      resolve('')
    }, 15000)

    win.webContents.on('did-fail-load', (_event, errorCode, _errorDescription, _validatedURL, isMainFrame) => {
      if (isDone || !isMainFrame || errorCode === -3) return
      isDone = true
      cleanup()
      resolve('')
    })

    const checkPage = async () => {
      if (isDone || !win || win.isDestroyed()) return

      try {
        const title = (win.webContents.getTitle() || '').toLowerCase()
        if (
          title.includes('just a moment') ||
          title.includes('attention required') ||
          title.includes('cloudflare') ||
          title.includes('turnstile')
        ) {
          return
        }

        const steamUrl = await win.webContents.executeJavaScript(`
          (() => {
            const body = document.body ? (document.body.innerText || '') : '';
            if (body.includes('There is currently no text in this page.')) {
              return '';
            }

            function getByXPath(xpath) {
              try {
                const res = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
                return res.singleNodeValue;
              } catch (e) {
                return null;
              }
            }

            // User specified xpath container:
            // /html/body/div[3]/div[2]/main/div/div/div[3]/div/div[2]/div[1]/div[1]/div[14]/div
            const container = getByXPath('/html/body/div[3]/div[2]/main/div/div/div[3]/div/div[2]/div[1]/div[1]/div[14]/div');
            let links = [];
            if (container) {
              links = Array.from(container.querySelectorAll('a'));
            }

            if (links.length === 0) {
              links = Array.from(document.querySelectorAll('.infobox-cell-2 a, .infobox a, a[href*="steamcommunity.com"]'));
            }

            for (const link of links) {
              const href = link.getAttribute('href') || link.href || '';
              if (href.includes('steamcommunity.com')) {
                return href;
              }
            }

            return '';
          })()
        `)

        if (typeof steamUrl === 'string' && steamUrl.trim()) {
          isDone = true
          cleanup()
          resolve(steamUrl.trim())
        }
      } catch {
        /* continue polling */
      }
    }

    win.webContents.on('did-finish-load', () => {
      checkPage()
    })

    pollInterval = setInterval(checkPage, 1000)

    win.loadURL(`https://liquipedia.net/counterstrike/${encodeURIComponent(username)}`).catch(() => {
      if (isDone) return
      isDone = true
      cleanup()
      resolve('')
    })
  })
}

export async function resolveSteamIdFromLiquipedia(username: string): Promise<string> {
  if (!username || !username.trim()) return ''

  const cleanName = username.trim()
  let steamProfileUrl = ''

  try {
    // 1. Try Liquipedia MediaWiki API (fast, robust, handles gzip)
    let apiData = await fetchLiquipediaApi(
      `action=parse&page=${encodeURIComponent(cleanName)}&prop=text&format=json&redirects=1`
    )

    let html = apiData?.parse?.text?.['*'] || ''

    // If missing title, try case-insensitive opensearch
    if (!html || apiData?.error?.code === 'missingtitle') {
      const searchData = await fetchLiquipediaApi(
        `action=opensearch&search=${encodeURIComponent(cleanName)}&limit=1&format=json`
      )
      if (searchData && Array.isArray(searchData[1]) && searchData[1].length > 0) {
        const bestMatch = searchData[1][0]
        apiData = await fetchLiquipediaApi(
          `action=parse&page=${encodeURIComponent(bestMatch)}&prop=text&format=json&redirects=1`
        )
        html = apiData?.parse?.text?.['*'] || ''
      }
    }

    if (html && !html.includes('There is currently no text in this page.')) {
      const steamMatches = html.match(
        /https?:\/\/(?:www\.)?steamcommunity\.com\/(?:id|profiles)\/[^\s"'<>]+/gi
      )
      if (steamMatches && steamMatches.length > 0) {
        steamProfileUrl = steamMatches[0]
      }
    }
  } catch (err: any) {
    console.warn('[HLTV Scraper] Liquipedia API lookup failed, falling back to BrowserWindow:', err.message)
  }

  // 2. Fallback to BrowserWindow if not found via API
  if (!steamProfileUrl) {
    try {
      steamProfileUrl = await fetchLiquipediaSteamViaBrowserWindow(cleanName)
    } catch (err: any) {
      console.warn('[HLTV Scraper] Liquipedia BrowserWindow lookup failed:', err.message)
    }
  }

  if (!steamProfileUrl) {
    return ''
  }

  // 3. Resolve SteamID64 via ?xml=1
  try {
    const xml = await fetchSteamXml(steamProfileUrl)
    if (xml) {
      const idMatch = xml.match(/<steamID64>(\d{17})<\/steamID64>/)
      if (idMatch && idMatch[1]) {
        return idMatch[1]
      }
    }
  } catch (err: any) {
    console.warn('[HLTV Scraper] Failed to resolve Steam XML for URL:', steamProfileUrl, err.message)
  }

  // 4. Fallback: if URL was already https://steamcommunity.com/profiles/<17-digit-id>
  const directIdMatch = steamProfileUrl.match(/\/profiles\/(\d{17})/)
  if (directIdMatch && directIdMatch[1]) {
    return directIdMatch[1]
  }

  return ''
}

